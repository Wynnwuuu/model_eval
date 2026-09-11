#!/usr/bin/env python3
"""Import a complete case × model/Prompt long CSV into the bundled audio evaluation."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import tempfile
import wave
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlparse

REQUIRED_COLUMNS = (
    "类别", "case_id", "音频链接", "时长_秒", "模型", "Prompt版本", "模型输出全文",
    "调用状态", "JSON语法有效", "结束原因", "请求ID",
)
ATTRIBUTION_COLUMNS = (
    "clip_id", "category_zh", "category", "source_dataset", "source_url",
    "audio_license", "audio_license_url", "sha256",
)
SELECTION_COLUMNS = (
    "clip_id", "category_zh", "category", "difficulty", "language", "duration_seconds",
    "file", "sha256", "qa_status", "qa_flags",
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def pretty_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def read_csv(path: Path, required: tuple[str, ...]) -> tuple[list[dict[str, str]], bytes]:
    raw = path.read_bytes()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    headers = reader.fieldnames or []
    if len(headers) != len(set(headers)) or not set(required).issubset(headers):
        raise ValueError(f"{path.name}: missing or duplicate CSV headers")
    rows = list(reader)
    if not rows or any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError(f"{path.name}: empty data or inconsistent column count")
    return rows, raw


def csv_bytes(rows: list[dict[str, str]], columns: tuple[str, ...]) -> bytes:
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=columns)
    writer.writeheader()
    writer.writerows({key: row[key] for key in columns} for row in rows)
    return text.getvalue().encode("utf-8-sig")


def duration(value: str, label: str) -> float:
    try:
        number = float(value)
    except ValueError as error:
        raise ValueError(f"{label}: invalid duration") from error
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{label}: duration must be positive and finite")
    return number


def audio_reference_matches(value: str, relative: str) -> bool:
    parsed = urlparse(value)
    if parsed.scheme not in ("", "file") or parsed.netloc not in ("", "localhost") or parsed.query or parsed.fragment:
        return False
    decoded = unquote(parsed.path if parsed.scheme else value).replace("\\", "/")
    if ".." in decoded.split("/"):
        return False
    return decoded == relative or decoded.endswith("/" + relative)


def reject_json_constant(value: str):
    raise ValueError(f"Non-standard JSON constant: {value}")


def prepare(args) -> tuple[dict, dict, dict[str, bytes], bytes, bytes]:
    """Read and validate every row and WAV before touching any existing output."""
    source_rows, source_bytes = read_csv(args.results_csv, REQUIRED_COLUMNS)
    manifest_rows, manifest_bytes = read_csv(args.audio_dir / "manifest.csv", tuple(set(ATTRIBUTION_COLUMNS + SELECTION_COLUMNS)))
    manifest = {row["clip_id"]: row for row in manifest_rows}
    if len(manifest) != len(manifest_rows):
        raise ValueError("manifest.csv: duplicate clip IDs")
    cases_by_id: dict[str, dict] = {}
    variants_by_key: dict[tuple[str, str], dict] = {}
    outputs_by_case: dict[str, dict] = {}
    for row_number, row in enumerate(source_rows, 2):
        case_id = row["case_id"].strip()
        model, prompt = row["模型"].strip(), row["Prompt版本"].strip()
        label = f"CSV row {row_number} ({case_id})"
        if not case_id or not model or not prompt or not row["类别"].strip():
            raise ValueError(f"{label}: case, model, Prompt, and category are required")
        if case_id not in manifest:
            raise ValueError(f"{label}: case ID absent from manifest")
        if row["调用状态"].strip().lower() != "ok":
            raise ValueError(f"{label}: unsuccessful model call")
        if row["JSON语法有效"].strip().lower() != "true":
            raise ValueError(f"{label}: source marks output as invalid JSON")
        if row["结束原因"].strip().lower() != "stop":
            raise ValueError(f"{label}: response did not finish normally")
        text = row["模型输出全文"]
        if not text.strip() or re.match(r"^\s*\[(?:BLOCKED|ERROR)\]", text, re.I):
            raise ValueError(f"{label}: missing or failed analysis")
        try:
            json.loads(text, parse_constant=reject_json_constant)
        except (ValueError, TypeError) as error:
            raise ValueError(f"{label}: analysis is not valid JSON despite source flag") from error
        item = manifest[case_id]
        if not audio_reference_matches(row["音频链接"], item["file"]):
            raise ValueError(f"{label}: audio path does not match its manifest case ID")
        seconds = duration(row["时长_秒"], label)
        if not math.isclose(seconds, duration(item["duration_seconds"], case_id), abs_tol=0.001, rel_tol=0):
            raise ValueError(f"{label}: duration differs from manifest")
        # Source labels may be aliases such as 环境音 for manifest 音效. They must
        # agree across every variant of this case and are recorded separately.
        metadata = {"category": row["类别"], "audioReference": row["音频链接"], "durationSeconds": seconds}
        if case_id in cases_by_id and cases_by_id[case_id] != metadata:
            raise ValueError(f"{label}: conflicting metadata for the same case")
        cases_by_id.setdefault(case_id, metadata)
        key = (model, prompt)
        if key not in variants_by_key:
            variants_by_key[key] = {
                "id": "variant-" + digest(canonical_json([model, prompt]))[:16],
                "name": f"{prompt}｜{model}", "modelName": model, "promptName": prompt, "isBaseline": False,
            }
        variant_id = variants_by_key[key]["id"]
        if variant_id in outputs_by_case.setdefault(case_id, {}):
            raise ValueError(f"{label}: duplicate case/model/Prompt output")
        # Deliberately retain the complete CSV field, including whitespace/newlines.
        outputs_by_case[case_id][variant_id] = text
    variants = list(variants_by_key.values())
    variant_ids = {variant["id"] for variant in variants}
    if not 2 <= len(variants) <= 5 or len(variant_ids) != len(variants):
        raise ValueError("Evaluation requires 2–5 distinct model/Prompt variants")
    if any(set(outputs) != variant_ids for outputs in outputs_by_case.values()):
        raise ValueError("Incomplete case × model/Prompt matrix; no cases or variants were silently dropped")
    assets: dict[str, bytes] = {}
    cases, selected_manifest, clip_checks = [], [], []
    audio_root = args.audio_dir.resolve()
    for case_id, metadata in cases_by_id.items():
        item = manifest[case_id]
        source_audio = (audio_root / item["file"]).resolve()
        if not source_audio.is_relative_to(audio_root) or not source_audio.is_file() or source_audio.suffix.lower() != ".wav":
            raise ValueError(f"{case_id}: missing or unsafe WAV path")
        if source_audio.name in assets:
            raise ValueError(f"{case_id}: duplicate flattened audio filename")
        audio_bytes = source_audio.read_bytes()
        audio_hash = digest(audio_bytes)
        if audio_hash != item["sha256"]:
            raise ValueError(f"{case_id}: WAV SHA-256 differs from manifest")
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav:
            actual_seconds = wav.getnframes() / wav.getframerate()
        if not math.isclose(actual_seconds, metadata["durationSeconds"], abs_tol=0.001, rel_tol=0):
            raise ValueError(f"{case_id}: decoded WAV duration differs from CSV")
        assets[source_audio.name] = audio_bytes
        cases.append({"id": case_id, "category": metadata["category"], "audioUrl": "/audio/" + source_audio.name,
                      "durationSeconds": metadata["durationSeconds"], "audioSha256": audio_hash,
                      "outputs": outputs_by_case[case_id]})
        selected_manifest.append(item)
        clip_checks.append({"id": case_id, "csvCategory": metadata["category"], "manifestCategory": item["category_zh"],
                            "durationSeconds": actual_seconds, "audioSha256": audio_hash,
                            "analysisSha256": {key: digest(value.encode("utf-8")) for key, value in outputs_by_case[case_id].items()}})
    source_hash = digest(source_bytes)
    fingerprint = digest(canonical_json({"variants": variants, "cases": cases}))
    dataset = {"id": f"audio-eval-{len(cases)}-{fingerprint[:16]}", "title": f"音频分析盲排 · {len(cases)} 条音频",
               "fingerprint": fingerprint, "sourceCsvSha256": source_hash, "variants": variants, "cases": cases}
    serialized = pretty_json(dataset).decode("utf-8")
    if "file:///" in serialized or str(args.results_csv.resolve()) in serialized or str(audio_root) in serialized:
        raise ValueError("Analysis contains an absolute source path; cannot both retain it and produce a path-free bundle")
    if any(row["请求ID"] and row["请求ID"] in serialized for row in source_rows):
        raise ValueError("Analysis contains a request ID; refusing to copy request identifiers into the bundle")
    # Recheck the source input at the end of preparation to avoid mixed snapshots.
    if args.results_csv.read_bytes() != source_bytes or (args.audio_dir / "manifest.csv").read_bytes() != manifest_bytes:
        raise ValueError("Input changed during import; rerun with stable source files")
    report = {
        "datasetId": dataset["id"], "fingerprint": fingerprint,
        "sourceCsvSha256": source_hash, "sourceManifestSha256": digest(manifest_bytes),
        "caseCount": len(cases), "variantCount": len(variants), "analysisCount": len(source_rows),
        "caseOrder": list(cases_by_id), "variants": variants,
        "categoryCounts": dict(Counter(item["category"] for item in cases)),
        "totalDurationSeconds": sum(item["durationSeconds"] for item in cases),
        "audioBytes": sum(map(len, assets.values())), "clips": clip_checks,
        "checks": {"completeMatrix": True, "uniqueCaseVariantPairs": True, "allCallsSuccessful": True,
                   "allAnalysesValidJson": True, "allAnalysisTextPreserved": True, "allAudioHashesVerified": True,
                   "allDurationsVerified": True, "originalSourcesUnchanged": True,
                   "noSourcePathsOrRequestIdsStored": True},
    }
    return dataset, report, assets, csv_bytes(selected_manifest, ATTRIBUTION_COLUMNS), csv_bytes(selected_manifest, SELECTION_COLUMNS)


def publish(outputs: list[tuple[Path, bytes | dict[str, bytes]]]) -> None:
    """Stage every target first, replace via same-filesystem rename, roll back on error."""
    pending = []
    completed = False
    try:
        for destination, content in outputs:
            destination.parent.mkdir(parents=True, exist_ok=True)
            folder = Path(tempfile.mkdtemp(prefix=f".{destination.name}.import-", dir=destination.parent))
            entry = {"destination": destination, "folder": folder, "staged": folder / "next", "backup": folder / "previous", "installed": False}
            pending.append(entry)
            if isinstance(content, dict):
                entry["staged"].mkdir()
                for name, data in content.items():
                    target = entry["staged"] / name
                    target.write_bytes(data)
                    if target.read_bytes() != data:
                        raise OSError("Staged audio failed readback verification")
            else:
                entry["staged"].write_bytes(content)
                if entry["staged"].read_bytes() != content:
                    raise OSError("Staged file failed readback verification")
        for entry in pending:
            if entry["destination"].exists():
                os.replace(entry["destination"], entry["backup"])
            os.replace(entry["staged"], entry["destination"])
            entry["installed"] = True
        completed = True
    except BaseException:
        rollback_errors = []
        for entry in reversed(pending):
            try:
                if entry["installed"]:
                    if entry["destination"].is_dir():
                        shutil.rmtree(entry["destination"])
                    else:
                        entry["destination"].unlink()
                if entry["backup"].exists():
                    os.replace(entry["backup"], entry["destination"])
            except OSError as error:
                rollback_errors.append(f"{entry['folder']}: {error}")
        if rollback_errors:
            raise RuntimeError("Import rollback needs recovery; original backups retained: " + "; ".join(rollback_errors))
        raise
    finally:
        for entry in pending:
            if completed or not entry["backup"].exists():
                shutil.rmtree(entry["folder"], ignore_errors=True)


def run(args) -> dict:
    destinations = [args.app_audio_dir, args.app_data, args.source_attribution, args.selection_csv, args.report]
    resolved = [path.resolve() for path in destinations]
    audio_root, source_csv = args.audio_dir.resolve(), args.results_csv.resolve()
    for index, path in enumerate(resolved):
        if path == source_csv or path.is_relative_to(audio_root) or audio_root.is_relative_to(path):
            raise ValueError("Output destinations must not overwrite the source CSV or audio pack")
        if any(path == other or path.is_relative_to(other) or other.is_relative_to(path) for other in resolved[index + 1:]):
            raise ValueError("Output destinations must be distinct and must not contain one another")
    if args.app_audio_dir.exists() and (not args.app_audio_dir.is_dir() or any(not item.is_file() or item.suffix.lower() != ".wav" for item in args.app_audio_dir.iterdir())):
        raise ValueError("Existing app audio directory may contain only WAV files; refusing to replace unrelated content")
    if any(path.exists() and not path.is_file() for path in destinations[1:]):
        raise ValueError("Data, documentation, and report destinations must be files")
    dataset, report, assets, attribution, selection = prepare(args)
    publish([(args.app_audio_dir, assets), (args.app_data, pretty_json(dataset)),
             (args.source_attribution, attribution), (args.selection_csv, selection), (args.report, pretty_json(report))])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("results-csv", "audio-dir", "app-data", "app-audio-dir", "source-attribution", "selection-csv", "report"):
        parser.add_argument("--" + flag, required=True, type=Path)
    report = run(parser.parse_args())
    print(json.dumps({key: report[key] for key in ("datasetId", "caseCount", "variantCount", "analysisCount", "caseOrder", "checks")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
