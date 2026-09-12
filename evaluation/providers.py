"""Standard-library audio adapters for OpenAI-compatible HTTP APIs.

Official protocol references (checked 2026-09-11):
https://help.aliyun.com/zh/model-studio/qwen-omni
https://help.aliyun.com/zh/model-studio/qwen3-omni-captioner

Qwen3.5-Omni requires streaming, even for text-only output. Captioner is a
fixed audio-only task: it cannot apply a system prompt. Its caller must opt
into ``prompt_mode='audio_only'`` instead of silently discarding a prompt.
"""

from __future__ import annotations

import base64
import email.utils
import http.client
import json
import os
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Iterator


CAPTIONER_MODEL = "qwen3-omni-30b-a3b-captioner"


class APIError(Exception):
    """Safe error information: never contains request bodies or credentials."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        retryable: bool = False,
        code: str = "api_error",
        request_id: str | None = None,
        retry_after: float | None = None,
        finish_reason: str | None = None,
        usage: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable
        self.code = code
        self.request_id = request_id
        self.retry_after = retry_after
        self.finish_reason = finish_reason
        self.usage = usage or {}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Do not forward a bearer credential to a redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def build_payload(
    config: dict[str, Any],
    audio_bytes: bytes,
    system_prompt: str,
    user_text: str,
) -> dict[str, Any]:
    """Build the exact request without network I/O (also used by tests)."""
    model = config.get("model")
    if not isinstance(model, str) or not model.strip():
        raise APIError("模型 ID 尚未配置", code="configuration_error")
    if not audio_bytes:
        raise APIError("音频文件为空", code="empty_audio")
    mode = config.get("prompt_mode", "system")
    if mode not in {"system", "audio_only"}:
        raise APIError("prompt_mode 只能是 system 或 audio_only", code="configuration_error")
    supports_prompt = config.get("supports_system_prompt", model != CAPTIONER_MODEL)
    if (not supports_prompt or model == CAPTIONER_MODEL) and mode != "audio_only":
        raise APIError(
            "此模型不支持 system prompt；固定音频基线须显式设置 prompt_mode=audio_only",
            code="unsupported_system_prompt",
        )
    encoding = config.get("audio_encoding", "base64")
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    if encoding == "data_uri":
        encoded = "data:;base64," + encoded
    elif encoding != "base64":
        raise APIError("audio_encoding 只能是 data_uri 或 base64", code="configuration_error")
    audio = {"data": encoded}
    if config.get("include_audio_format", model != CAPTIONER_MODEL):
        audio["format"] = config.get("audio_format", "wav")
    content = [{"type": "input_audio", "input_audio": audio}]
    messages: list[dict[str, Any]] = []
    if mode == "system":
        if not system_prompt.strip():
            raise APIError("system prompt 为空", code="empty_system_prompt")
        messages.append({"role": "system", "content": system_prompt})
        if user_text:
            content.append({"type": "text", "text": user_text})
    messages.append({"role": "user", "content": content})
    streaming = bool(config.get("stream", False))
    if model in {"qwen3.5-omni-plus", "qwen3.5-omni-flash"} and not streaming:
        raise APIError("Qwen3.5-Omni 必须配置 stream=True", code="configuration_error")
    body: dict[str, Any] = {"model": model, "messages": messages, "stream": streaming}
    if streaming:
        body["stream_options"] = {"include_usage": True}
    for key in ("modalities", "temperature", "top_p", "seed", "max_tokens", "max_completion_tokens"):
        if config.get(key) is not None:
            body[key] = config[key]
    if "max_tokens" in body and "max_completion_tokens" in body:
        raise APIError("只能配置一种输出 token 上限参数", code="configuration_error")
    return body


def _endpoint(config: dict[str, Any]) -> str:
    endpoint = config.get("endpoint")
    if not endpoint:
        base = config.get("base_url", "").rstrip("/")
        endpoint = base + "/chat/completions" if base else ""
    parts = urllib.parse.urlsplit(endpoint)
    # HTTP is accepted only for a local mock server used during offline tests.
    local_http = parts.scheme == "http" and parts.hostname in {"127.0.0.1", "localhost", "::1"}
    if (parts.scheme != "https" and not local_http) or not parts.hostname or parts.username or parts.password:
        raise APIError("请配置有效的 HTTPS API 端点", code="configuration_error")
    if parts.query or parts.fragment or "{" in endpoint or "}" in endpoint:
        raise APIError("API 端点仍含占位符或不允许的查询参数", code="configuration_error")
    return endpoint


def _safe_identifier(value: Any) -> str | None:
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:/-]{1,160}", value):
        return value
    return None


def _request_id(headers) -> str | None:
    for key in ("x-request-id", "x-dashscope-request-id", "request-id"):
        value = _safe_identifier(headers.get(key))
        if value:
            return value
    return None


def _retry_after(headers) -> float | None:
    value = headers.get("retry-after", "")
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            when = email.utils.parsedate_to_datetime(value)
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


def _service_error(data: dict[str, Any], *, status=None, request_id=None, retry_after=None) -> APIError:
    error = data.get("error", data)
    if not isinstance(error, dict):
        error = {}
    code = _safe_identifier(error.get("code")) or _safe_identifier(error.get("type")) or "api_error"
    request_id = request_id or _safe_identifier(data.get("request_id"))
    retryable = status in {408, 409, 425, 429} or (isinstance(status, int) and status >= 500)
    retryable = retryable or code.lower() == "limit_burst_rate" or any(
        part in code.lower()
        for part in ("throttl", "ratelimit", "rate_limit", "overload", "internalerror", "serviceunavailable")
    )
    # Raw server messages can echo the request, including its audio or API key.
    # Persist only a bounded identifier, HTTP status, and our local explanation.
    meaning = {
        400: "请求参数不受服务支持",
        401: "API token 无效或未授权",
        403: "没有模型或业务空间访问权限",
        404: "端点或模型不存在",
        413: "请求音频或正文超过服务限制",
        429: "服务限流或配额不足",
    }.get(status, "服务返回错误")
    return APIError(
        f"{meaning}（HTTP {status if status is not None else 'stream'}，code={code}）",
        status=status, retryable=retryable, code=code,
        request_id=request_id, retry_after=retry_after,
    )


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise APIError("请求超过总超时时间", retryable=True, code="request_timeout")
    return remaining


def _read_chunks(response, deadline: float, limit: int) -> Iterator[bytes]:
    """Read available bytes and refresh the socket's total-deadline timeout."""
    read = getattr(response, "read1", response.read)
    total = 0
    while True:
        remaining = _remaining(deadline)
        raw = getattr(getattr(response, "fp", None), "raw", None)
        sock = getattr(raw, "_sock", None)
        if sock is not None:
            sock.settimeout(remaining)
        chunk = read(65536)
        _remaining(deadline)
        if not chunk:
            return
        total += len(chunk)
        if total > limit:
            raise APIError("模型响应超过本地大小限制", code="response_too_large")
        yield chunk


def _parse_json(data: bytes) -> dict[str, Any]:
    try:
        value = json.loads(data)
    except (ValueError, UnicodeDecodeError):
        raise APIError("服务返回了无效 JSON", retryable=True, code="invalid_response") from None
    if not isinstance(value, dict):
        raise APIError("服务 JSON 不是对象", retryable=True, code="invalid_response")
    return value


def _text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(item.get("text", "") for item in content if isinstance(item, dict) and isinstance(item.get("text"), str))
    return ""


def _parse_nonstream(data: dict[str, Any], request_id: str | None) -> dict[str, Any]:
    if "error" in data:
        raise _service_error(data, request_id=request_id)
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise APIError("模型响应中没有候选答案", retryable=True, code="invalid_response", request_id=request_id)
    choice = choices[0]
    message = choice.get("message", {})
    if not isinstance(message, dict):
        message = {}
    result = {
        "text": _text_content(message.get("content")),
        "finish_reason": choice.get("finish_reason"),
        "usage": data.get("usage") if isinstance(data.get("usage"), dict) else {},
        "request_id": request_id or _safe_identifier(data.get("id")),
    }
    if not result["finish_reason"]:
        raise APIError("模型响应缺少结束标记", retryable=True, code="incomplete_response", request_id=result["request_id"])
    if not result["text"].strip():
        code = "model_refusal" if message.get("refusal") or choice.get("finish_reason") == "content_filter" else "empty_output"
        raise APIError("模型未返回分析文本", code=code, request_id=result["request_id"], finish_reason=result["finish_reason"], usage=result["usage"])
    return result


def _sse_payloads(chunks: Iterator[bytes]) -> Iterator[bytes]:
    """SSE parsing handles split UTF-8, CRLF, comments and multi-line events."""
    buffer = b""
    event_data: list[bytes] = []
    first = True
    for chunk in chunks:
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            line = line.rstrip(b"\r")
            if first:
                line = line.removeprefix(b"\xef\xbb\xbf")
                first = False
            if not line:
                if event_data:
                    yield b"\n".join(event_data)
                    event_data = []
            elif line.startswith(b"data:"):
                event_data.append(line[5:].removeprefix(b" "))
    if buffer:
        line = buffer.rstrip(b"\r")
        if line.startswith(b"data:"):
            event_data.append(line[5:].removeprefix(b" "))
    if event_data:
        yield b"\n".join(event_data)


def _parse_stream(chunks: Iterator[bytes], request_id: str | None) -> dict[str, Any]:
    fragments: list[str] = []
    finish_reason = None
    usage: dict[str, Any] = {}
    refusal = False
    for event in _sse_payloads(chunks):
        if event.strip() == b"[DONE]":
            break
        data = _parse_json(event)
        if "error" in data or ("code" in data and "choices" not in data):
            raise _service_error(data, request_id=request_id)
        request_id = request_id or _safe_identifier(data.get("id"))
        if isinstance(data.get("usage"), dict):
            usage = data["usage"]
        choices = data.get("choices", [])
        if not isinstance(choices, list):
            raise APIError("流式 choices 格式无效", retryable=True, code="invalid_response", request_id=request_id)
        for choice in choices:
            if not isinstance(choice, dict) or choice.get("index", 0) != 0:
                continue
            delta = choice.get("delta", {})
            if isinstance(delta, dict):
                fragments.append(_text_content(delta.get("content")))
                refusal = refusal or bool(delta.get("refusal"))
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]
    if not finish_reason:
        raise APIError("流式连接在结束标记之前中断", retryable=True, code="interrupted_stream", request_id=request_id)
    text = "".join(fragments)
    if not text.strip():
        raise APIError("模型未返回分析文本", code="model_refusal" if refusal or finish_reason == "content_filter" else "empty_output", request_id=request_id, finish_reason=finish_reason, usage=usage)
    return {"text": text, "finish_reason": finish_reason, "usage": usage, "request_id": request_id}


def invoke(
    config: dict[str, Any],
    token: str,
    audio_bytes: bytes,
    system_prompt: str,
    user_text: str,
    timeout: float = 180.0,
) -> dict[str, Any]:
    """Make one attempt. Retry/backoff and output persistence belong to runner."""
    if not token or not token.strip():
        raise APIError("API token 尚未配置", code="missing_token")
    if "\n" in token or "\r" in token:
        raise APIError("API token 格式无效", code="configuration_error")
    if timeout <= 0:
        raise APIError("timeout 必须大于 0", code="configuration_error")
    payload = build_payload(config, audio_bytes, system_prompt, user_text)
    endpoint = _endpoint(config)
    try:
        context = ssl.create_default_context()
        ca_file = config.get("ca_file") or os.environ.get("SSL_CERT_FILE")
        if ca_file:
            context.load_verify_locations(cafile=ca_file)
    except (OSError, ssl.SSLError):
        raise APIError("无法加载受信任 CA 证书，请检查 ca_file 或 SSL_CERT_FILE", code="tls_configuration_error") from None
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), _NoRedirect())
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token.strip(),
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if payload["stream"] else "application/json",
            "User-Agent": "audio-caption-eval/1.0",
        },
        method="POST",
    )
    deadline = time.monotonic() + timeout
    request_id = None
    try:
        with opener.open(request, timeout=_remaining(deadline)) as response:
            request_id = _request_id(response.headers)
            chunks = _read_chunks(response, deadline, int(config.get("max_response_bytes", 16 * 1024 * 1024)))
            content_type = response.headers.get("content-type", "").lower()
            if "text/event-stream" in content_type:
                result = _parse_stream(chunks, request_id)
            else:
                result = _parse_nonstream(_parse_json(b"".join(chunks)), request_id)
            _remaining(deadline)
    except urllib.error.HTTPError as error:
        request_id = _request_id(error.headers)
        # Discard all raw text; extract only validated service identifiers.
        try:
            error_data = _parse_json(b"".join(_read_chunks(error, deadline, 65536)))
        except (APIError, OSError, http.client.HTTPException):
            error_data = {}
        finally:
            error.close()
        raise _service_error(error_data, status=error.code, request_id=request_id, retry_after=_retry_after(error.headers)) from None
    except urllib.error.URLError as error:
        tls = isinstance(error.reason, (ssl.SSLError, ssl.CertificateError))
        raise APIError(
            "TLS 证书验证失败，请配置受信任的 CA 证书" if tls else "无法连接 API 服务",
            retryable=not tls,
            code="tls_verification_failed" if tls else "network_error", request_id=request_id,
        ) from None
    except (socket.timeout, TimeoutError):
        raise APIError("请求超过总超时时间", retryable=True, code="request_timeout", request_id=request_id) from None
    except (OSError, http.client.HTTPException):
        raise APIError("API 网络连接中断", retryable=True, code="network_error", request_id=request_id) from None
    result["prompt_applied"] = config.get("prompt_mode", "system") == "system"
    result["warnings"] = [] if result["prompt_applied"] else ["固定音频基线：此结果未应用 system prompt。"]
    return result
