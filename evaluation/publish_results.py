#!/usr/bin/env python3
"""校验本轮 30×4 原始返回，生成长表并更新本地盲评数据；不调用 API。"""
import argparse
import csv
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

from config import ROOT, DEFAULT_DATASET, model_configs
from dataset import load_dataset
from prompts import PROMPT_LABELS
from run_eval import column_specs, task_for


def publish(run_dir: Path):
    repo = ROOT.parent
    origin = json.loads((ROOT / "selection_origin.json").read_text())
    samples = load_dataset(DEFAULT_DATASET, manifest=ROOT / "cases.csv", expected_count=30)
    if [s.clip_id for s in samples] != origin["case_ids"]:
        raise ValueError("30-case selection/order changed")
    if {s.clip_id: s.sha256 for s in samples} != origin["audio_sha256"]:
        raise ValueError("Original audio bytes changed")
    run_config = json.loads((run_dir / "run_config.json").read_text())
    if run_config["dry_run"] or run_config["use_references"]:
        raise ValueError("Publication requires real audio calls without reference answers")
    manifest = {r["clip_id"]: r for r in csv.DictReader((ROOT / "cases.csv").open(encoding="utf-8-sig"))}
    models = model_configs()
    specs = column_specs(models)
    if len(specs) != 4:
        raise ValueError("Exactly two models × two Prompts are required")
    rows = []
    for sample in samples:
        for prompt_id, model in specs:
            task = task_for(sample, prompt_id, model, False)
            record = json.loads((run_dir / "responses" / (task["key"] + ".json")).read_text())
            if record["request_hash"] != task["key"] or record["audio_sha256"] != sample.sha256:
                raise ValueError("Response identity mismatch")
            if record["status"] != "ok" or record.get("finish_reason") != "stop" or not record.get("text", "").strip():
                raise ValueError(f"Incomplete response: {sample.clip_id}/{prompt_id}/{model['id']}; not publishing a partial matrix")
            rows.append({"类别": manifest[sample.clip_id]["category_zh"], "case_id": sample.clip_id,
                         "音频链接": sample.audio_url, "时长_秒": sample.duration_seconds,
                         "模型": model["label"], "Prompt版本": PROMPT_LABELS[prompt_id],
                         "模型输出全文": record["text"], "调用状态": record["status"],
                         "JSON语法有效": str(record.get("json_valid", False)).lower(),
                         "结束原因": record["finish_reason"], "请求ID": record.get("request_id") or ""})
    long_csv = run_dir / "results_long.csv"
    with long_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]), quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)
    spec = importlib.util.spec_from_file_location("audio_importer", repo / "scripts" / "import-audio-evaluation.py")
    importer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(importer)
    dataset, report, assets, attribution, selection = importer.prepare(SimpleNamespace(
        results_csv=long_csv, audio_dir=DEFAULT_DATASET, manifest=ROOT / "cases.csv", allow_invalid_json=True))
    if report["caseOrder"] != origin["case_ids"] or report["analysisCount"] != 120 or report["variantCount"] != 4:
        raise ValueError("Imported matrix/order changed")
    # WAVs are already bundled and validated by prepare(); never overwrite them.
    for filename, content in assets.items():
        if (DEFAULT_DATASET / filename).read_bytes() != content:
            raise ValueError("Audio changed during import")
    summary = json.loads((run_dir / "summary.json").read_text())
    report["requestSummary"] = {"completedOutputs": len(rows), "totalAttempts": summary["attempts"],
                                "extraAttempts": summary["attempts"] - len(rows)}
    report["baseCodeCommit"] = "a808097"
    report["selectionOrigin"] = origin
    report["promptSources"] = json.loads((ROOT / "prompt_sources.json").read_text())
    report["modelApiIds"] = {m["label"]: m["model"] for m in models}
    report["aggregateCatalog"] = {key: {field: value.get(field) for field in ("id", "displayName", "featureTags")}
                                  for key, value in run_config.get("discovery", {}).items() if value}
    public_report = {k: report[k] for k in ("datasetId", "fingerprint", "caseCount", "variantCount", "analysisCount",
        "caseOrder", "categoryCounts", "totalDurationSeconds", "requestSummary", "checks", "jsonSummary", "formatFindings", "allowInvalidJson", "promptSources", "modelApiIds", "aggregateCatalog", "baseCodeCommit")}
    importer.publish([(repo / "src/data/evaluation.json", importer.pretty_json(dataset)),
                      (repo / "docs/audio-sources.csv", attribution), (repo / "docs/selection.csv", selection),
                      (repo / "docs/evaluation-run.json", importer.pretty_json(public_report)),
                      (run_dir / "import_report.json", importer.pretty_json(report))])
    print(json.dumps(public_report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, default=ROOT / "results/full")
    publish(parser.parse_args().run_dir.resolve())
