#!/usr/bin/env python3
"""Regression tests for the long-CSV importer; no user files are accessed."""

import argparse
import csv
import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("audio_import", Path(__file__).with_name("import-audio-evaluation.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="audio-import-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.audio = self.root / "source-audio"
        self.audio.mkdir()
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(8000)
            wav.writeframes(b"\0\0" * 8000)
        audio_bytes = buffer.getvalue()
        self.manifest = []
        columns = tuple(dict.fromkeys(importer.ATTRIBUTION_COLUMNS + importer.SELECTION_COLUMNS))
        for case_id in ("C-01", "C-02"):
            filename = f"clips/{case_id}.wav"
            (self.audio / "clips").mkdir(exist_ok=True)
            (self.audio / filename).write_bytes(audio_bytes)
            self.manifest.append({**dict.fromkeys(columns, ""), "clip_id": case_id, "file": filename,
                                  "category_zh": "音乐", "category": "music", "difficulty": "simple",
                                  "duration_seconds": "1.0", "sha256": hashlib.sha256(audio_bytes).hexdigest()})
        (self.audio / "manifest.csv").write_bytes(importer.csv_bytes(self.manifest, columns))
        self.rows = []
        # Deliberately differ from manifest order to exercise first-seen CSV order.
        for case_id in ("C-02", "C-01"):
            for prompt in ("原版", "2.2"):
                self.rows.append({"类别": "音乐", "case_id": case_id,
                                  "音频链接": (self.audio / f"clips/{case_id}.wav").as_uri(), "时长_秒": "1",
                                  "模型": "sample-model", "Prompt版本": prompt,
                                  "模型输出全文": '\n  ' + json.dumps({"description": f"{case_id}：{prompt}，原文\n第二行", "status": "quiet"}, ensure_ascii=False, indent=2) + '  \n',
                                  "调用状态": "ok", "JSON语法有效": "true", "结束原因": "stop",
                                  "请求ID": f"opaque-request-{case_id}-{prompt}"})
        self.source = self.root / "results.csv"
        self.write_source()
        self.args = argparse.Namespace(results_csv=self.source, audio_dir=self.audio,
                                       app_data=self.root / "app/data/evaluation.json", app_audio_dir=self.root / "app/public/audio",
                                       source_attribution=self.root / "app/docs/audio-sources.csv", selection_csv=self.root / "app/docs/selection.csv",
                                       report=self.root / "report.json")

    def write_source(self):
        self.source.write_bytes(importer.csv_bytes(self.rows, importer.REQUIRED_COLUMNS))

    def test_exact_text_case_order_hashes_and_source_preservation(self):
        original = self.source.read_bytes()
        self.args.app_audio_dir.mkdir(parents=True)
        (self.args.app_audio_dir / "obsolete.wav").write_bytes(b"old asset")
        report = importer.run(self.args)
        dataset = json.loads(self.args.app_data.read_text())
        self.assertEqual([item["id"] for item in dataset["cases"]], ["C-02", "C-01"])
        self.assertEqual(sorted(path.name for path in self.args.app_audio_dir.iterdir()), ["C-01.wav", "C-02.wav"])
        for case in dataset["cases"]:
            for variant in dataset["variants"]:
                source = next(row for row in self.rows if row["case_id"] == case["id"] and row["Prompt版本"] == variant["promptName"])
                self.assertEqual(case["outputs"][variant["id"]], source["模型输出全文"])
            self.assertEqual(hashlib.sha256((self.args.app_audio_dir / Path(case["audioUrl"]).name).read_bytes()).hexdigest(), case["audioSha256"])
        self.assertEqual(self.source.read_bytes(), original)
        self.assertTrue(all(report["checks"].values()))
        self.assertNotIn(str(self.root), self.args.app_data.read_text())
        self.assertNotIn("opaque-request-", self.args.app_data.read_text())

    def test_request_ids_do_not_change_evaluation_fingerprint(self):
        first, _, _, _, _ = importer.prepare(self.args)
        for row in self.rows:
            row["请求ID"] += "-new-call"
        self.write_source()
        second, _, _, _, _ = importer.prepare(self.args)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["variants"], second["variants"])
        self.assertNotEqual(first["sourceCsvSha256"], second["sourceCsvSha256"])

    def test_duplicate_missing_failed_and_conflicting_rows_fail_before_writing(self):
        initial_rows = [dict(row) for row in self.rows]
        mutations = {
            "duplicate": lambda rows: rows.append(dict(rows[0])),
            "missing": lambda rows: rows.pop(),
            "call failed": lambda rows: rows[0].update({"调用状态": "error"}),
            "invalid syntax flag": lambda rows: rows[0].update({"JSON语法有效": "false"}),
            "invalid JSON": lambda rows: rows[0].update({"模型输出全文": "{malformed"}),
            "truncated": lambda rows: rows[0].update({"结束原因": "length"}),
            "metadata conflict": lambda rows: rows[1].update({"类别": "another category"}),
            "wrong audio": lambda rows: rows[0].update({"音频链接": rows[2]["音频链接"]}),
            "duration mismatch": lambda rows: rows[0].update({"时长_秒": "2"}),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                self.rows = [dict(row) for row in initial_rows]
                mutate(self.rows)
                self.write_source()
                with self.assertRaises(ValueError):
                    importer.run(self.args)
                self.assertFalse(self.args.app_data.exists())
                self.assertFalse(self.args.app_audio_dir.exists())

    def test_wav_corruption_fails_before_writing(self):
        (self.audio / "clips/C-02.wav").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            importer.run(self.args)
        self.assertFalse(self.args.app_data.exists())

    def test_publish_error_restores_previous_files_and_audio_directory(self):
        existing_audio = self.root / "existing-audio"
        existing_audio.mkdir()
        (existing_audio / "old.wav").write_bytes(b"old WAV")
        existing_json = self.root / "existing.json"
        existing_json.write_bytes(b"old JSON")
        original_replace = os.replace
        calls = 0

        def fail_once(source, destination):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise OSError("simulated failure after directory replaced and JSON backed up")
            return original_replace(source, destination)

        with patch.object(importer.os, "replace", side_effect=fail_once):
            with self.assertRaisesRegex(OSError, "simulated failure"):
                importer.publish([(existing_audio, {"new.wav": b"new WAV"}), (existing_json, b"new JSON")])
        self.assertEqual(existing_json.read_bytes(), b"old JSON")
        self.assertEqual(list(path.name for path in existing_audio.iterdir()), ["old.wav"])
        self.assertEqual((existing_audio / "old.wav").read_bytes(), b"old WAV")
        self.assertEqual(list(self.root.glob(".*.import-*")), [])


if __name__ == "__main__":
    unittest.main()
