"""三模型配置；凭证只从环境变量或本地未跟踪文件读取。"""
import json
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parent
DEFAULT_DATASET = ROOT.parent / "public" / "audio"
AGGREGATE_BASE_URL = "https://api-dev-product-infra-platform.sandaii.cn/svc/model/api/v1/llm"
MODELS = [
    dict(id="gemini31_pro", label="Gemini 3.1 Pro", model="video-caption-opt",
         base_url=AGGREGATE_BASE_URL, token_env="AGGREGATE_API_KEY", provider="sandai",
         audio_encoding="base64", stream=True, max_completion_tokens=16384,
         discovery_url=AGGREGATE_BASE_URL + "/models"),
    # The user confirmed this aggregate alias is Gemini 3.8 Flash.
    dict(id="gemini38_flash", label="Gemini 3.8 Flash", model="gemini-audio-test",
         base_url=AGGREGATE_BASE_URL, token_env="AGGREGATE_API_KEY", provider="sandai",
         audio_encoding="base64", stream=True, max_completion_tokens=16384,
         discovery_url=AGGREGATE_BASE_URL + "/models"),
    dict(id="qwen35_plus", label="Qwen3.5-Omni-Plus", model="qwen3.5-omni-plus",
         base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
         token_env="DASHSCOPE_API_KEY", provider="bailian", audio_encoding="data_uri",
         stream=True, modalities=["text"], max_tokens=16384),
]

def credentials():
    path = ROOT / ".local" / "credentials.json"
    saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return {m["id"]: os.environ.get(m["token_env"], saved.get(m["token_env"], "")) for m in MODELS}

def model_configs():
    ca = os.environ.get("SSL_CERT_FILE", "")
    if not ca and (ROOT / ".local" / "ca.pem").exists(): ca = str(ROOT / ".local" / "ca.pem")
    configs = [dict(m, audio_format="wav", prompt_mode="system") for m in MODELS]
    for m in configs:
        if ca: m["ca_file"] = ca
    return configs
