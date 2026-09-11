#!/usr/bin/env python3
"""Build a reproducible, metadata-only balanced subset without rewriting CSV cells."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote, urlparse

LEVELS = ("simple", "medium", "hard")
DEFAULT_SEED = "audio-eval-balanced-v1"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def read_csv_records(path: Path):
    """Return parsed cells and original physical record bytes, including embedded newlines."""
    raw = path.read_bytes()
    physical_lines = raw.splitlines(keepends=True)
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    headers = next(reader)
    previous_line = reader.line_num
    header_bytes = b"".join(physical_lines[:previous_line])
    records = []
    for values in reader:
        record_bytes = b"".join(physical_lines[previous_line:reader.line_num])
        previous_line = reader.line_num
        if not values:
            continue
        if len(values) != len(headers):
            raise ValueError(f"{path.name}: unexpected column count at line {reader.line_num}")
        records.append((dict(zip(headers, values)), record_bytes))
    if len(headers) != len(set(headers)):
        raise ValueError(f"{path.name}: duplicate CSV headers")
    return headers, header_bytes, records, raw


def balance_score(rows: tuple[dict, ...], seed: str):
    # No caption, transcript, model response, loudness, or subjective quality enters selection.
    score = []
    for field in ("category", "language"):
        counts = Counter(row[field] for row in rows)
        score.extend((-len(counts), sum(count * count for count in counts.values())))
    composition_types = {row.get("composition", "").split(";", 1)[0].strip() for row in rows}
    score.append(-len(composition_types))
    tie = sha256_bytes(json_bytes([seed, sorted(row["clip_id"] for row in rows)]))
    return (*score, tie)


def select_balanced(manifest_rows: list[dict], per_category: int, seed: str):
    groups = defaultdict(list)
    for row in manifest_rows:
        if row["difficulty"] not in LEVELS:
            raise ValueError(f"Unknown difficulty for {row['clip_id']}: {row['difficulty']}")
        groups[row["category_zh"]].append(row)
    chosen = []
    quotas = {}
    for category_index, category in enumerate(sorted(groups)):
        base, remainder = divmod(per_category, len(LEVELS))
        quota = {level: base + (level_index in {(category_index + offset) % 3 for offset in range(remainder)})
                 for level_index, level in enumerate(LEVELS)}
        by_difficulty = {level: sorted((row for row in groups[category] if row["difficulty"] == level),
                                      key=lambda row: row["clip_id"]) for level in LEVELS}
        if any(len(by_difficulty[level]) < quota[level] for level in LEVELS):
            raise ValueError(f"Insufficient manifest candidates for balanced quota: {category}: {quota}")
        candidates = (
            tuple(itertools.chain.from_iterable(parts))
            for parts in itertools.product(*(itertools.combinations(by_difficulty[level], quota[level]) for level in LEVELS))
        )
        winner = min(candidates, key=lambda rows: balance_score(rows, f"{seed}:{category}"))
        chosen.extend(winner)
        quotas[category] = quota
    return {row["clip_id"] for row in chosen}, quotas


def safe_audio_path(audio_dir: Path, relative: str) -> Path:
    path = (audio_dir / relative).resolve()
    if not path.is_relative_to(audio_dir.resolve()) or not path.is_file():
        raise ValueError(f"Missing or invalid manifest audio path: {relative}")
    return path


def match_result_row(audio_value: str, manifest_rows: list[dict]) -> str:
    parsed = urlparse(audio_value)
    source = unquote(parsed.path if parsed.scheme else audio_value).replace("\\", "/")
    matches = [row["clip_id"] for row in manifest_rows
               if source == row["file"] or source.endswith("/" + row["file"])]
    if len(matches) != 1:
        raise ValueError(f"Audio reference must map to exactly one manifest row: {audio_value}")
    return matches[0]


def parse_variant(column: str):
    baseline = re.fullmatch(r"(.+?)\s*[（(]\s*固定基线\s*[）)]", column.strip())
    parts = re.split(r"[｜|]", column.strip())
    model = baseline.group(1).strip() if baseline else parts[1].strip() if len(parts) == 2 else column
    return {
        "id": "variant-" + sha256_bytes(column.encode("utf-8"))[:16],
        "name": column,
        "modelName": model,
        "promptName": None if baseline or len(parts) != 2 else parts[0].strip(),
        "isBaseline": bool(baseline),
    }


def result_status(text: str) -> str:
    if not text.strip():
        return "empty"
    if re.match(r"^\s*\[(BLOCKED|ERROR)\]", text, re.I):
        return "failed"
    return "valid"


def build(args):
    audio_dir, output_dir = args.audio_dir.resolve(), args.output_dir.resolve()
    for destination in (output_dir, args.app_data, args.app_audio_dir, args.source_attribution):
        if destination and (destination.resolve().is_relative_to(audio_dir) or destination.resolve() == args.results_csv.resolve()):
            raise ValueError("Output destinations must not overwrite the original audio pack or results CSV")
    manifest_path = audio_dir / "manifest.csv"
    manifest_headers, manifest_header_bytes, manifest_records, manifest_raw = read_csv_records(manifest_path)
    manifest_rows = [row for row, _ in manifest_records]
    if len({row["clip_id"] for row in manifest_rows}) != len(manifest_rows):
        raise ValueError("Duplicate manifest clip IDs")
    # Freeze membership before reading any model answers.
    selected_ids, quotas = select_balanced(manifest_rows, args.per_category, args.seed)
    selected_manifest = [row for row in manifest_rows if row["clip_id"] in selected_ids]
    result_headers, result_header_bytes, result_records, result_raw = read_csv_records(args.results_csv)
    audio_column = args.audio_column or result_headers[0]
    by_clip = {}
    for row, original_bytes in result_records:
        clip_id = match_result_row(row[audio_column], manifest_rows)
        if clip_id in by_clip:
            raise ValueError(f"Duplicate result row for {clip_id}")
        by_clip[clip_id] = (row, original_bytes)
    if selected_ids - by_clip.keys():
        raise ValueError(f"Selected clips lack results: {sorted(selected_ids - by_clip.keys())}")
    selected_results = [(row, raw) for row, raw in result_records
                        if match_result_row(row[audio_column], manifest_rows) in selected_ids]
    result_columns = [column for column in result_headers if column != audio_column]
    status_counts = {column: dict(Counter(result_status(row[column]) for row, _ in selected_results))
                     for column in result_columns}
    active_columns = [column for column in result_columns if status_counts[column].get("valid") == len(selected_ids)]
    partial = [column for column in result_columns if 0 < status_counts[column].get("valid", 0) < len(selected_ids)]
    if partial:
        raise ValueError(f"Selected rows contain incomplete result columns; selection is not altered: {partial}")
    if len(active_columns) != args.expected_variants:
        raise ValueError(f"Expected {args.expected_variants} complete variants, found {len(active_columns)}")
    variants = [parse_variant(column) for column in active_columns]
    if len({variant["id"] for variant in variants}) != len(variants):
        raise ValueError("Variant identity collision")

    jsonl_path = audio_dir / "manifest.jsonl"
    jsonl_records = [(json.loads(line), line) for line in jsonl_path.read_bytes().splitlines(keepends=True) if line.strip()]
    jsonl_by_id = {row["clip_id"]: (row, raw) for row, raw in jsonl_records}
    if selected_ids - jsonl_by_id.keys():
        raise ValueError("manifest.jsonl is missing selected clips")
    audio_by_clip = {}
    for row in selected_manifest:
        source = safe_audio_path(audio_dir, row["file"])
        if sha256_bytes(source.read_bytes()) != row["sha256"]:
            raise ValueError(f"Audio SHA-256 differs from manifest: {row['clip_id']}")
        if jsonl_by_id[row["clip_id"]][0]["sha256"] != row["sha256"]:
            raise ValueError(f"CSV and JSONL manifest disagree: {row['clip_id']}")
        audio_by_clip[row["clip_id"]] = source
    basenames = [path.name for path in audio_by_clip.values()]
    if len(basenames) != len(set(basenames)):
        raise ValueError("Basename collision prevents flat app audio export")
    if args.app_audio_dir and args.app_audio_dir.exists():
        unrelated = [path.name for path in args.app_audio_dir.iterdir() if path.name not in basenames]
        if unrelated:
            raise ValueError(f"App audio directory contains files outside this subset; use a fresh directory: {unrelated}")

    # Presentation order is independent of selection: one clip per category in
    # each round, preserving manifest order within each category and the CSV.
    category_order = list(dict.fromkeys(row["category_zh"] for row in selected_manifest))
    presentation_rows = [row for position in range(args.per_category) for category in category_order
                         for row in [[entry for entry in selected_manifest if entry["category_zh"] == category][position]]]
    cases = [{
        "id": row["clip_id"], "category": row["category_zh"],
        "audioUrl": "/audio/" + audio_by_clip[row["clip_id"]].name,
        "durationSeconds": float(row["duration_seconds"]), "audioSha256": row["sha256"],
        "outputs": {variant["id"]: by_clip[row["clip_id"]][0][variant["name"]] for variant in variants},
    } for row in presentation_rows]
    fingerprint = sha256_bytes(json_bytes({"seed": args.seed, "variants": variants, "cases": cases}))
    dataset = {"id": f"audio-eval-{len(cases)}-{fingerprint[:16]}", "title": f"音频分析盲排 · {len(cases)} 条均衡样本",
               "fingerprint": fingerprint, "variants": variants, "cases": cases}

    if output_dir.exists() and any(output_dir.iterdir()):
        raise ValueError(f"Output folder is not empty; choose a fresh path: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    pack = output_dir / f"clip-pack-{len(cases)}"
    pack.mkdir()
    (output_dir / "results.csv").write_bytes(result_header_bytes + b"".join(raw for _, raw in selected_results))
    (pack / "manifest.csv").write_bytes(manifest_header_bytes + b"".join(raw for row, raw in manifest_records if row["clip_id"] in selected_ids))
    (pack / "manifest.jsonl").write_bytes(b"".join(raw for row, raw in jsonl_records if row["clip_id"] in selected_ids))
    for row in selected_manifest:
        target = pack / row["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(audio_by_clip[row["clip_id"]], target)
        if sha256_bytes(target.read_bytes()) != row["sha256"]:
            raise ValueError(f"Copied audio verification failed: {row['clip_id']}")
    if args.app_data:
        args.app_data.parent.mkdir(parents=True, exist_ok=True)
        args.app_data.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.app_audio_dir:
        args.app_audio_dir.mkdir(parents=True, exist_ok=True)
        for source in audio_by_clip.values():
            shutil.copy2(source, args.app_audio_dir / source.name)
            if sha256_bytes((args.app_audio_dir / source.name).read_bytes()) != sha256_bytes(source.read_bytes()):
                raise ValueError(f"App audio copy failed verification: {source.name}")
    if args.source_attribution:
        args.source_attribution.parent.mkdir(parents=True, exist_ok=True)
        attribution_columns = ["clip_id", "category_zh", "category", "source_dataset", "source_url", "audio_license", "audio_license_url", "sha256"]
        with args.source_attribution.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=attribution_columns)
            writer.writeheader()
            writer.writerows({key: row[key] for key in attribution_columns} for row in selected_manifest)

    selection_columns = ["clip_id", "category_zh", "category", "difficulty", "language", "duration_seconds", "file", "sha256", "qa_status", "qa_flags"]
    with (output_dir / "selection.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=selection_columns)
        writer.writeheader()
        writer.writerows({key: row[key] for key in selection_columns} for row in selected_manifest)
    category_counts = dict(Counter(row["category_zh"] for row in selected_manifest))
    difficulty_counts = dict(Counter(row["difficulty"] for row in selected_manifest))
    report = {
        "dataset_id": dataset["id"], "seed": args.seed, "selected_clip_ids": [row["clip_id"] for row in selected_manifest],
        "category_counts": category_counts, "difficulty_counts": difficulty_counts, "difficulty_quotas": quotas,
        "subtype_counts": dict(Counter(row["category"] for row in selected_manifest)),
        "language_counts": dict(Counter(row["language"] for row in selected_manifest)),
        "presentation_clip_ids": [case["id"] for case in cases],
        "presentation_category_order": category_order,
        "duration_seconds": sum(float(row["duration_seconds"]) for row in selected_manifest),
        "result_status_counts": status_counts, "valid_analysis_count": len(cases) * len(variants),
        "source_results_sha256": sha256_bytes(result_raw), "source_manifest_sha256": sha256_bytes(manifest_raw),
        "subset_results_sha256": sha256_bytes((output_dir / "results.csv").read_bytes()), "fingerprint": fingerprint,
        "checks": {"original_csv_record_bytes_preserved": True, "audio_sha256_verified": True,
                   "per_category_equal": all(count == args.per_category for count in category_counts.values()),
                   "source_files_unchanged": args.results_csv.read_bytes() == result_raw and manifest_path.read_bytes() == manifest_raw},
    }
    # Independently read back cell values as well as asserting byte-for-byte record copies.
    saved_headers, _, saved_records, _ = read_csv_records(output_dir / "results.csv")
    if saved_headers != result_headers or [row for row, _ in saved_records] != [row for row, _ in selected_results]:
        raise ValueError("CSV readback differs from original selected cells")
    report["checks"]["all_csv_cells_equal"] = True
    (output_dir / "selection-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = [f"# {len(cases)} 条音频均衡子集", "", f"数据集 ID：`{dataset['id']}`。保留原 {len(manifest_rows)} 条来源文件，仅创建子集副本。", "",
               "## 选样规则", "", f"固定种子：`{args.seed}`。仅使用 manifest 的类别、难度、语言、composition 首段和 clip_id。先冻结选样，再读取模型返回；不按模型答案优劣筛选。", "",
               f"按 category_zh 排序，每类 {args.per_category} 条。simple / medium / hard 配额先平均分配，余数按类别序号轮转，因此六类共 30 条时三种难度各 10 条。", "",
               "满足难度配额后，优先覆盖 category 子类并均衡其数量，再覆盖并均衡 language，随后最大化 composition 首段类型覆盖；同分用固定种子的 SHA-256 最小值选定。人声、乐器单轨两种子类均保留。", "",
               "语言只采用来源标签：en 为英语，mostly_non_speech 为非语音为主，unknown_or_music 为音乐或未知；原数据没有其他明确语种，不虚构多语种覆盖。QA 标记只列示，不作为模型优劣筛选依据。", "",
               "评审展示按 manifest 中大类首次出现的顺序轮流交错，每连续 6 题覆盖各大类 1 条，各类内部保持源顺序。CSV 仍保留原始行顺序；展示顺序不改变选中的 30 条样本。", "",
               "## 类别与难度", "", "| 类别 | 总数 | simple | medium | hard | 时长（秒） |", "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for category in sorted(quotas):
        group = [row for row in selected_manifest if row["category_zh"] == category]
        summary.append(f"| {category} | {len(group)} | {quotas[category]['simple']} | {quotas[category]['medium']} | {quotas[category]['hard']} | {sum(float(row['duration_seconds']) for row in group):g} |")
    summary += ["", f"合计 {len(cases)} 段，{len(variants)} 个有效方案，{len(cases) * len(variants)} 份分析。总时长 {report['duration_seconds']:g} 秒。", "",
                "results.csv 保留原 8 列及所选行原始字节；空的 Gemini 两列继续保留，评审数据只装入五个完整方案。30 个 WAV 与 manifest SHA-256 一致，没有转码、截断或修改。", "",
                "clip-pack-30 内相对目录与原包一致，选择该文件夹即可匹配 CSV 的原始音频路径。源码版另在 public/audio 内置相同 WAV，在 src/data/evaluation.json 中内置完整分析。", "",
                "明细见 selection.csv；可机器复核的配额、输入哈希、输出哈希和检查结果见 selection-report.json。", "",
                "复现：`python3 scripts/select-audio-evaluation-subset.py --results-csv <源CSV> --audio-dir <原音频包> --output-dir <新的空输出目录> --app-data <evaluation.json路径> --app-audio-dir <public/audio目录>`。"]
    (output_dir / "README.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results-csv", type=Path, required=True)
    parser.add_argument("--audio-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--app-data", type=Path)
    parser.add_argument("--app-audio-dir", type=Path)
    parser.add_argument("--source-attribution", type=Path)
    parser.add_argument("--audio-column")
    parser.add_argument("--per-category", type=int, default=5)
    parser.add_argument("--expected-variants", type=int, default=5)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    args = parser.parse_args()
    if args.per_category < 3:
        parser.error("--per-category must cover all three difficulties")
    report = build(args)
    print(json.dumps({key: report[key] for key in ("dataset_id", "category_counts", "difficulty_counts", "subtype_counts", "language_counts", "duration_seconds", "valid_analysis_count", "checks")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
