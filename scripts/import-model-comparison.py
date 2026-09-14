#!/usr/bin/env python3
"""Create a fixed, auditable comparison snapshot without relying on blind labels."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def rows(raw):
    return list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))


def parsed_output(text):
    match = re.fullmatch(r'\s*```(?:json)?\s*\n(.*?)\n```\s*', text, re.DOTALL)
    return json.loads(match.group(1) if match else text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--first15', type=Path, required=True)
    parser.add_argument('--colleague-zip', type=Path, required=True)
    parser.add_argument('--previous-second15', type=Path)
    parser.add_argument('--check', action='store_true', help='Compare regenerated artifacts without writing files')
    args = parser.parse_args()
    dataset = json.loads((ROOT / 'src/data/evaluation.json').read_text())
    require(len(dataset['cases']) == 30 and len(dataset['variants']) == 3, 'Expected the original 30-case, 3-model dataset')
    variant_by_name = {(v['modelName'], v['promptName']): v for v in dataset['variants']}
    require(len(variant_by_name) == 3, 'Model and prompt identities must be unique')
    first_bytes = args.first15.read_bytes()
    zip_bytes = args.colleague_zip.read_bytes()
    first_rows = rows(first_bytes)
    require(len(first_rows) == 45 and all(r['Status'] == 'ranked' for r in first_rows), 'First source must contain exactly 15 complete rankings')
    archive = {}
    with ZipFile(io.BytesIO(zip_bytes)) as zipped:
        for info in zipped.infolist():
            name = info.filename if info.flag_bits & 0x800 else info.filename.encode('cp437').decode('utf-8')
            require(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts, 'Unsafe archive path')
            if info.is_dir():
                continue
            require(name not in archive, 'Duplicate archive path: ' + name)
            archive[name] = zipped.read(info)
    roots = {name.split('/')[0] for name in archive}
    require(len(roots) == 1, 'Expected a single archive root')
    root = next(iter(roots))
    colleague_bytes = archive[root + '/本次排序明细.csv']
    colleague_rows = rows(colleague_bytes)
    index_bytes = archive[root + '/后15题索引.csv']
    index_rows = rows(index_bytes)
    require(len(colleague_rows) == 45 and len(index_rows) == 15, 'Colleague ZIP must cover 15 cases and 45 ranks')
    require(dataset['id'] in archive[root + '/README.md'].decode('utf-8'), 'Archive dataset identity mismatch')
    index_by_case = {r['SourceID']: r for r in index_rows}
    require(len(index_by_case) == 15, 'Duplicate archive index case')
    expected_first = {c['id'] for c in dataset['cases'][:15]}
    expected_second = {c['id'] for c in dataset['cases'][15:]}
    require({r['SourceID'] for r in first_rows} == expected_first, 'First source case set mismatch')
    require({r['SourceID'] for r in colleague_rows} == expected_second == set(index_by_case), 'Colleague source case set mismatch')
    source_groups = {'first15_csv': first_rows, 'colleague_zip': colleague_rows}
    snapshot_cases = []
    audit_rows = []
    for case_number, original_case in enumerate(dataset['cases'], 1):
        case_id = original_case['id']
        source_key = 'first15_csv' if case_number <= 15 else 'colleague_zip'
        current_rows = [r for r in source_groups[source_key] if r['SourceID'] == case_id]
        require(len(current_rows) == 3, f'{case_id}: expected 3 rankings')
        require(sorted(int(r['Rank']) for r in current_rows) == [1, 2, 3], f'{case_id}: ranks must be 1, 2, 3')
        require(len({(r['ModelName'], r['PromptName']) for r in current_rows}) == 3, f'{case_id}: duplicate model')
        audio_bytes = (ROOT / 'public' / original_case['audioUrl'].lstrip('/')).read_bytes()
        require(sha(audio_bytes) == original_case['audioSha256'], f'{case_id}: local audio hash mismatch')
        outputs, rankings = {}, []
        for record in current_rows:
            identity = (record['ModelName'], record['PromptName'])
            require(identity in variant_by_name, f'{case_id}: unknown model/prompt {identity}')
            variant = variant_by_name[identity]
            variant_id = variant['id']
            rank = int(record['Rank'])
            if source_key == 'first15_csv':
                require(record['DatasetID'] == dataset['id'] and record['VariantID'] == variant_id, f'{case_id}: identity mismatch in first CSV')
                require(record['Category'] == original_case['category'] and record['AudioFile'] == original_case['audioUrl'], f'{case_id}: case metadata mismatch')
                require(record['IsBaseline'].lower() == str(variant['isBaseline']).lower(), f'{case_id}: baseline mismatch')
                text = original_case['outputs'][variant_id]
                source_file = 'src/data/evaluation.json#' + case_id + '/' + variant_id
            else:
                idx = index_by_case[case_id]
                require(int(record['题号']) == case_number == int(idx['题号']), f'{case_id}: case number mismatch')
                require(idx['分类'] == original_case['category'] and float(idx['时长（秒）']) == original_case['durationSeconds'], f'{case_id}: archive metadata mismatch')
                require(idx[f'第{rank}名'] == variant['modelName'], f'{case_id}: ZIP index and ranking disagree')
                case_dir = f'第{case_number}题_{case_id}'
                require(idx['音频文件'] == case_dir + '/' + Path(original_case['audioUrl']).name, f'{case_id}: archive audio path mismatch')
                require(sha(archive[root + '/' + idx['音频文件']]) == original_case['audioSha256'], f'{case_id}: archive audio hash mismatch')
                source_file = case_dir + '/' + variant['modelName'] + '__' + variant['promptName'] + '.json'
                raw = archive[root + '/' + source_file]
                text = raw.decode('utf-8')
                require(text.encode('utf-8') == raw, f'{case_id}: output byte roundtrip failed')
                require(parsed_output(text) == parsed_output(original_case['outputs'][variant_id]), f'{case_id}: ZIP output content differs from dataset for {identity}')
            outputs[variant_id] = text
            digest = sha(text.encode('utf-8'))
            rankings.append({'rank': rank, 'variantId': variant_id, 'outputSha256': digest})
            audit_rows.append({'caseNumber': case_number, 'caseId': case_id, 'variantId': variant_id, 'modelName': variant['modelName'],
                               'promptName': variant['promptName'], 'rank': rank, 'sourceKey': source_key, 'sourceFile': source_file, 'outputSha256': digest})
        snapshot_cases.append({**original_case, 'caseNumber': case_number, 'sourceKey': source_key,
                               'outputs': outputs, 'rankings': sorted(rankings, key=lambda r: r['rank'])})
    previous_matches = None
    if args.previous_second15:
        previous = [r for r in rows(args.previous_second15.read_bytes()) if r['Status'] == 'ranked']
        authoritative = {(r['SourceID'], r['ModelName'], r['PromptName']): int(r['Rank']) for r in colleague_rows}
        for record in previous:
            require(record['DatasetID'] == dataset['id'], 'Previous second-half dataset mismatch')
            key = (record['SourceID'], record['ModelName'], record['PromptName'])
            require(authoritative.get(key) == int(record['Rank']), 'Previous CSV disagrees with ZIP: ' + str(key))
        previous_matches = len(previous)
    snapshot = {'schemaVersion': 1, 'id': dataset['id'] + ':comparison:' + sha(first_bytes + zip_bytes)[:12],
                'sourceDatasetId': dataset['id'], 'title': '三模型音频评测结果', 'variants': dataset['variants'],
                'sources': [{'key': 'first15_csv', 'label': '前15题评审', 'fileName': args.first15.name, 'sha256': sha(first_bytes)},
                            {'key': 'colleague_zip', 'label': '后15题同事确认', 'fileName': args.colleague_zip.name, 'sha256': sha(zip_bytes)}],
                'cases': snapshot_cases}
    audit = {'datasetId': dataset['id'], 'caseCount': 30, 'outputCount': len(audit_rows),
             'sourceDatasetSha256': sha((ROOT / 'src/data/evaluation.json').read_bytes()), 'sources': snapshot['sources'],
             'archiveAudioMatches': 15, 'archiveOutputSemanticMatches': 45, 'archiveIndexRankMatches': 45,
             'previousSecondHalfRankMatches': previous_matches, 'outputs': audit_rows}
    artifacts = {
        ROOT / 'src/data/model-comparison.json': (json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
        ROOT / 'docs/comparison-sources/first15-rankings.csv': first_bytes,
        ROOT / 'docs/comparison-sources/colleague-rankings.csv': colleague_bytes,
        ROOT / 'docs/comparison-sources/colleague-index.csv': index_bytes,
        ROOT / 'docs/comparison-audit.json': (json.dumps(audit, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
    }
    for path, content in artifacts.items():
        if args.check:
            require(path.read_bytes() == content, 'Artifact mismatch: ' + str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    print(json.dumps({'mode': 'checked' if args.check else 'imported', 'cases': 30, 'outputs': len(audit_rows),
                      'archiveAudioMatches': 15, 'previousSecondHalfRankMatches': previous_matches,
                      'lastCaseRanking': [variant_by_name[(r['modelName'], r['promptName'])]['modelName'] for r in sorted(audit_rows[-3:], key=lambda r: r['rank'])]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
