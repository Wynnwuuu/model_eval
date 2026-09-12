#!/usr/bin/env python3
"""两个模型 × 两版 Prompt；Python 3.10+，仅使用标准库。"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
import csv
import hashlib
import json
import os
from pathlib import Path
import random
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import urllib.parse

from config import ROOT, DEFAULT_DATASET, credentials, model_configs
from dataset import load_dataset
from prompts import PROMPTS, PROMPT_LABELS, render_prompt
from providers import APIError, invoke

VERSION = "2.0"
USER_INSTRUCTION = "请根据附带的实际音频完成 Caption 标注。音频元数据："


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def atomic_json(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def reject_json_constant(value):
    raise ValueError("Non-standard JSON constant: " + value)


def json_diagnostics(text):
    try:
        value = json.loads(text, parse_constant=reject_json_constant)
        return {"json_valid": True, "json_object_valid": isinstance(value, dict)}
    except (ValueError, TypeError):
        return {"json_valid": False, "json_object_valid": False}


def safe_error(exc, tokens):
    message = str(exc)
    for token in tokens:
        if token:
            message = message.replace(token, "[REDACTED]")
    return message[:1200]


@contextmanager
def output_lock(folder):
    """操作系统锁随进程结束释放，防止两个进程覆盖同一结果。"""
    handle = (folder / ".run.lock").open("a+")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            if not handle.read(1):
                handle.write("0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise RuntimeError("该输出目录已有运行中的任务，请换目录或等待它结束。")
    try:
        yield
    finally:
        handle.close()


class RateGate:
    def __init__(self, rpm):
        self.interval = 60.0 / rpm
        self.next_at = 0.0
        self.lock = threading.Lock()

    def wait(self, stop):
        with self.lock:
            now = time.monotonic()
            delay = max(0.0, self.next_at - now)
            self.next_at = max(now, self.next_at) + self.interval
        if stop.wait(delay):
            raise InterruptedError("任务已中断")


def context_for(sample, use_references):
    meta = {"duration_s": sample.duration_seconds, "channels": sample.channels,
            "sample_rate_hz": sample.sample_rate}
    asr = sample.ref_asr if use_references else ""
    lyrics = sample.ref_lyrics if use_references else ""
    text = USER_INSTRUCTION + canonical(meta)
    # 不发送文件名、数据集类别、来源字幕、caption/情绪标签等参考答案。
    text += "\nREF_ASR：" + (asr or "未提供") + "\nREF_LYRICS：" + (lyrics or "未提供")
    return text, asr, lyrics


def task_for(sample, prompt_id, model, use_references):
    user, asr, lyrics = context_for(sample, use_references)
    baseline = model.get("prompt_mode") == "audio_only"
    system = "" if baseline else render_prompt(prompt_id, asr, lyrics)
    effective_system, effective_user = ("", "") if baseline else (system, user)
    relevant = {k: v for k, v in model.items()
                if k not in {"id", "label", "token_env", "ca_file", "discovery_url"}}
    request_hash = digest({"version": VERSION, "audio_sha256": sample.sha256,
                           "system": effective_system, "user": effective_user,
                           "model": relevant})
    return dict(key=request_hash, sample=sample, prompt_id=prompt_id, model=model,
                system=effective_system, user=effective_user,
                system_prompt_sha256=digest(effective_system), baseline=baseline)


def discover(model, token, timeout):
    """聚合 API 必须先从租户模型目录确认 model ID 和 audio_input 能力。"""
    if not model.get("discovery_url"):
        return None
    parts = urllib.parse.urlsplit(model["discovery_url"])
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise RuntimeError("模型目录地址必须是无凭据/查询参数的 HTTPS URL")
    ctx = ssl.create_default_context(cafile=model.get("ca_file"))
    req = urllib.request.Request(model["discovery_url"], headers={"Authorization": "Bearer " + token})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ctx))
    with opener.open(req, timeout=timeout) as response:
        body = json.load(response)
    matches = [m for m in body.get("data", []) if m.get("id") == model["model"]]
    if not matches:
        raise RuntimeError("MODEL_NOT_AVAILABLE：当前 token 的模型目录不含 " + model["model"])
    if "audio_input" not in matches[0].get("featureTags", []):
        raise RuntimeError("AUDIO_NOT_SUPPORTED：该逻辑模型未启用 audio_input")
    return matches[0]


def base_record(task):
    return dict(request_hash=task["key"], audio_sha256=task["sample"].sha256,
                model=task["model"]["model"], model_id=task["model"]["id"],
                prompt_id="audio_only_baseline" if task["baseline"] else task["prompt_id"],
                system_prompt_sha256=task["system_prompt_sha256"],
                prompt_applied=None, text="", attempts=0)


def execute(task, token, gate, semaphore, stop, disabled, state_lock, args):
    result = base_record(task)
    started = time.monotonic()
    with semaphore:
        for attempt in range(args.retries + 1):
            if stop.is_set():
                result.update(status="cancelled", error="用户中断")
                break
            with state_lock:
                fatal = disabled.get(task["model"]["id"])
            if fatal:
                result.update(status="blocked", error=fatal)
                break
            try:
                gate.wait(stop)
                result["attempts"] += 1
                audio_bytes = task["sample"].path.read_bytes()
                if hashlib.sha256(audio_bytes).hexdigest() != task["sample"].sha256:
                    raise RuntimeError("音频在预检查后发生变化，请重新启动任务")
                reply = invoke(task["model"], token, audio_bytes,
                               task["system"], task["user"], args.timeout)
                result.update(reply)
                finish = reply.get("finish_reason")
                result["status"] = "truncated" if finish in ("length", "max_tokens") else "ok"
                if finish in ("content_filter", "tool_calls"):
                    result["status"] = "incomplete"
                result.update(json_diagnostics(reply["text"]))
                break
            except InterruptedError:
                result.update(status="cancelled", error="用户中断")
                break
            except Exception as exc:
                error = safe_error(exc, [token])
                result.update(status="error", error=error,
                              error_code=getattr(exc, "code", type(exc).__name__),
                              http_status=getattr(exc, "status", None),
                              request_id=getattr(exc, "request_id", None),
                              finish_reason=getattr(exc, "finish_reason", None),
                              usage=getattr(exc, "usage", {}))
                # 已知权限或模型错误，停止这一模型后续请求，避免把相同错误放大到300次。
                if getattr(exc, "status", None) in (401, 403, 404):
                    with state_lock:
                        disabled[task["model"]["id"]] = error
                if not getattr(exc, "retryable", False) or attempt >= args.retries:
                    break
                retry_after = getattr(exc, "retry_after", None)
                delay = min(60.0, max(float(retry_after or 0), 2 ** attempt + random.random()))
                if stop.wait(delay):
                    result.update(status="cancelled", error="用户中断")
                    break
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    result["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    return result


def csv_cell(record, model_id=None):
    if not record:
        return ""
    if record.get("text"):
        return record["text"]
    return ""  # API 错误单独记录，不填入模型分析。


def column_specs(models):
    """同一个 Prompt 的两个模型相邻。"""
    return [(p, m) for p in PROMPTS for m in models]


def export(folder, samples, models, mapping, records):
    specs = column_specs(models)
    headers = ["音频链接"] + [
        m["label"] + "（固定基线）" if p == "audio_only_baseline"
        else PROMPT_LABELS[p] + "｜" + m["label"] for p, m in specs]
    tmp = folder / "results.csv.tmp"
    cells = []
    with tmp.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, quoting=csv.QUOTE_ALL)
        writer.writerow(headers)
        for sample in samples:
            row = [sample.audio_url]
            for prompt_id, m in specs:
                key = mapping[(sample.clip_id, prompt_id, m["id"])]
                record = records.get(key)
                row.append(csv_cell(record, m["id"]))
                cells.append(dict(clip_id=sample.clip_id, prompt_id=prompt_id,
                                  model_id=m["id"], request_hash=key,
                                  status=record.get("status") if record else "not_run",
                                  prompt_applied=record.get("prompt_applied") if record else None,
                                  json_valid=record.get("json_valid") if record else None))
            writer.writerow(row)
    os.replace(tmp, folder / "results.csv")
    atomic_json(folder / "cell_status.json", cells)
    counts = dict(Counter(c["status"] for c in cells))
    unique = {c["request_hash"] for c in cells}
    atomic_json(folder / "summary.json", dict(audio_count=len(samples),
                result_columns=len(headers)-1, cell_status_counts=counts,
                unique_requests_with_audio=sum(1 for k in unique if records.get(k, {}).get("attempts", 0)),
                attempts=sum(records.get(k, {}).get("attempts", 0) + records.get(k, {}).get("prior_attempts", 0) for k in unique),
                csv="results.csv", status_details="cell_status.json",
                raw_response_directory="responses",
                note="CSV保留模型全文，包括非JSON或被截断的文本；完成状态见cell_status.json。"))
    return counts


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--manifest", type=Path, default=ROOT / "cases.csv")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--models", nargs="+", choices=[m["id"] for m in model_configs()])
    parser.add_argument("--prompts", nargs="+", choices=list(PROMPTS))
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--per-model-workers", type=int, default=2)
    parser.add_argument("--rpm", type=float, default=20, help="每个模型每分钟最大请求数")
    parser.add_argument("--timeout", type=float, default=240)
    parser.add_argument("--retries", type=int, default=2, help="仅对临时接口错误重试")
    parser.add_argument("--use-references", action="store_true", help="只使用显式 ref_asr/ref_lyrics，不读 transcript")
    parser.add_argument("--dry-run", action="store_true", help="只校验本地数据并生成CSV预览，零API调用")
    parser.add_argument("--check-api", action="store_true", help="只检查配置/聚合模型目录，不发送音频")
    parser.add_argument("--rerun", action="store_true", help="重新请求成功项，会再次产生API费用")
    args = parser.parse_args()
    for name in ("workers", "per_model_workers", "rpm", "timeout"):
        if getattr(args, name) <= 0:
            parser.error(name + " 必须大于 0")
    if args.retries < 0 or (args.limit is not None and args.limit < 1):
        parser.error("retries 不能为负，limit 必须大于 0")
    if not args.output_dir:
        args.output_dir = ROOT / "results" / ("preview" if args.dry_run else "full")
    return args


def main():
    args = parse_args()
    models = model_configs()
    tokens = credentials()
    selected_models = set(args.models or [m["id"] for m in models])
    selected_prompts = set(args.prompts or PROMPTS)
    disabled, discoveries = {}, {}
    if not args.dry_run:
        for m in models:
            if m["id"] not in selected_models:
                continue
            if m.get("supports_system_prompt") is False and m["prompt_mode"] != "audio_only":
                disabled[m["id"]] = "UNSUPPORTED_SYSTEM_PROMPT：本轮要求两个模型均支持 system prompt"
                continue
            if not tokens.get(m["id"]):
                disabled[m["id"]] = "MISSING_TOKEN：请填写 " + m["token_env"]
                continue
            try:
                discoveries[m["id"]] = discover(m, tokens[m["id"]], min(30, args.timeout))
            except Exception as exc:
                disabled[m["id"]] = safe_error(exc, tokens.values())
        for m in models:
            if m["id"] in selected_models:
                print(m["label"] + "：" + disabled.get(m["id"], "配置就绪"), flush=True)
        if args.check_api:
            print("百炼的权限与模型可用性仍须用音频请求验证。")
            return 2 if disabled else 0
    samples = load_dataset(args.dataset, manifest=args.manifest)
    if args.limit:
        samples = samples[:args.limit]
    folder = args.output_dir.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    with output_lock(folder):
        prior_config = folder / "run_config.json"
        if prior_config.exists():
            prior = json.loads(prior_config.read_text(encoding="utf-8"))
            if bool(prior.get("dry_run")) != args.dry_run:
                raise RuntimeError("预览与真实评测必须使用不同输出目录，防止覆盖结果。")
            old_samples = [(s["clip_id"], s["sha256"]) for s in prior.get("audio", [])]
            new_samples = [(s.clip_id, s.sha256) for s in samples]
            if old_samples != new_samples:
                raise RuntimeError("输出目录对应的样本集合/顺序已改变，请使用新的 --output-dir。")
        return run(args, samples, models, tokens, selected_models, selected_prompts,
                   disabled, discoveries, folder)


def run(args, samples, models, tokens, selected_models, selected_prompts, disabled, discoveries, folder):
    mapping, tasks = {}, {}
    for sample in samples:
        for prompt_id, m in column_specs(models):
            task = task_for(sample, prompt_id, m, args.use_references)
            mapping[(sample.clip_id, prompt_id, m["id"])] = task["key"]
            if m["id"] in selected_models and (prompt_id in selected_prompts or prompt_id == "audio_only_baseline"):
                tasks.setdefault(task["key"], task)
    (folder / "responses").mkdir(exist_ok=True)
    db = sqlite3.connect(folder / "checkpoint.sqlite3")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, record TEXT NOT NULL)")
    records = {key: json.loads(value) for key, value in db.execute("SELECT key,record FROM results")}

    def save(key, record):
        previous = records.get(key)
        if previous is not None:
            with (folder / "attempt_history.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(canonical(previous) + "\n")
            record["prior_attempts"] = previous.get("prior_attempts", 0) + previous.get("attempts", 0)
        records[key] = record
        db.execute("INSERT OR REPLACE INTO results VALUES (?,?)", (key, canonical(record)))
        db.commit()
        atomic_json(folder / "responses" / (key + ".json"), record)

    atomic_json(folder / "prompts_used.json", {
        p: {"label": PROMPT_LABELS[p], "template": PROMPTS[p],
            "system_without_references": render_prompt(p, "", "")} for p in PROMPTS})

    atomic_json(folder / "run_config.json", dict(version=VERSION, dataset=str(args.dataset.resolve()),
        prompt_order=list(PROMPTS), model_order=[m["id"] for m in models],
        prompts={p: dict(label=PROMPT_LABELS[p], source_sha256=digest(PROMPTS[p])) for p in PROMPTS},
        models=[{k:v for k,v in m.items() if k not in ("ca_file", "token_env")} for m in models],
        selected_models=sorted(selected_models), selected_prompts=sorted(selected_prompts),
        use_references=args.use_references, temperature="provider default (not overridden)",
        discovery=discoveries, dry_run=args.dry_run,
        audio=[dict(clip_id=s.clip_id, audio_url=s.audio_url, sha256=s.sha256,
                    duration_s=s.duration_seconds, channels=s.channels) for s in samples]))
    pending = []
    for key, task in tasks.items():
        previous = records.get(key)
        # 截断和非JSON属于模型评测结果，默认保留，不能因格式不佳反复生成挑选答案。
        if previous and previous.get("status") in ("ok", "truncated", "incomplete") and not args.rerun:
            continue
        if args.dry_run:
            record = base_record(task)
            record.update(status="dry_run", error="仅检查输入与列结构，尚未请求模型")
            save(key, record)
        elif task["model"]["id"] in disabled:
            record = base_record(task)
            record.update(status="blocked", error=disabled[task["model"]["id"]])
            save(key, record)
        else:
            pending.append(task)
    export(folder, samples, models, mapping, records)
    print(f"音频 {len(samples)} 条；每行{len(column_specs(models))}个结果列+音频链接；本次待调用 {len(pending)} 项。", flush=True)
    if args.dry_run:
        db.close()
        print("本地预检查完成：" + str(folder / "results.csv"))
        return 0
    stop = threading.Event()
    state_lock = threading.Lock()
    gates = {m["id"]: RateGate(args.rpm) for m in models}
    semaphores = {m["id"]: threading.Semaphore(args.per_model_workers) for m in models}
    executor = ThreadPoolExecutor(max_workers=args.workers)
    futures = {}
    saved_futures = set()
    interrupted = False
    try:
        for task in pending:
            mid = task["model"]["id"]
            future = executor.submit(execute, task, tokens[mid], gates[mid], semaphores[mid],
                                     stop, disabled, state_lock, args)
            futures[future] = task
        done = 0
        for future in as_completed(futures):
            task = futures[future]
            record = future.result()
            save(task["key"], record)
            saved_futures.add(future)
            done += 1
            print(f"[{done}/{len(pending)}] {task['sample'].clip_id} / "
                  f"{task['prompt_id']} / {task['model']['id']} → {record['status']}", flush=True)
            if done % 10 == 0:
                export(folder, samples, models, mapping, records)
    except KeyboardInterrupt:
        interrupted = True
        stop.set()
        for future in futures:
            future.cancel()
        print("已停止新请求，等待在途请求保存；再次运行相同命令可续跑。", flush=True)
    finally:
        executor.shutdown(wait=True, cancel_futures=interrupted)
        for future, task in futures.items():
            if future.done() and not future.cancelled() and future not in saved_futures:
                save(task["key"], future.result())
        counts = export(folder, samples, models, mapping, records)
        db.close()
    print("结果：" + str(folder / "results.csv"), flush=True)
    print("状态：" + canonical(counts), flush=True)
    return 130 if interrupted else (2 if any(counts.get(s, 0) for s in
               ("error", "blocked", "cancelled", "truncated", "incomplete")) else 0)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError) as exc:
        print("错误：" + safe_error(exc, credentials().values()), file=sys.stderr)
        sys.exit(2)
