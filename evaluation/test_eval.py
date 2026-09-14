"""Offline regressions for the 30-case, two-model, Wynn-prompt comparison.

Run with ``python3 evaluation/test_eval.py`` from the repository root.
All inference is mocked; no credentials or network connections are used.
"""

import argparse
import base64
from collections import Counter, defaultdict
from contextlib import redirect_stdout
import csv
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config
from dataset import load_dataset
from prompts import PROMPTS, PROMPT_LABELS, render_prompt
from providers import APIError, build_payload
import run_eval as runner


MODEL_IDS = ["doubao_seed20_lite", "qwen35_plus"]
PROMPT_IDS = ["wynn"]


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="audio-evaluation-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dataset = self.root / "audio"
        self.dataset.mkdir()
        self.output = self.root / "results"
        self.output.mkdir()
        self.models = config.model_configs()
        self.tokens = {mid: "offline-only-token-" + mid for mid in MODEL_IDS}
        # A missed mock must fail locally instead of issuing any HTTP request.
        network = patch("urllib.request.OpenerDirector.open",
                        side_effect=AssertionError("Network is forbidden in offline tests"))
        network.start()
        self.addCleanup(network.stop)

    def samples(self, count=1):
        rows = []
        for index in range(count):
            name = f"PRIVATE_FILENAME_{index:02d}.wav"
            with wave.open(str(self.dataset / name), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(8000)
                audio.writeframes(struct.pack("<80h", *([index + 1] * 80)))
            rows.append(dict(
                file=name, clip_id=f"PRIVATE_CASE_ID_{index:02d}",
                audio_url=f"https://audio.example.test/clip-{index:02d}.wav",
                transcript="PRIVATE_REFERENCE_TRANSCRIPT",
                category="PRIVATE_CATEGORY_ANSWER",
                caption="PRIVATE_CAPTION_ANSWER",
                source_url="https://private-source.example.test/answer",
                ref_asr="PRIVATE_EXPLICIT_ASR",
                ref_lyrics="PRIVATE_EXPLICIT_LYRICS",
            ))
        manifest = self.dataset / "manifest.jsonl"
        manifest.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
        return load_dataset(self.dataset, expected_count=count)

    def run_batch(self, samples, invoke, **overrides):
        args = argparse.Namespace(
            dataset=self.dataset, use_references=False, dry_run=False,
            rerun=False, workers=4, per_model_workers=2, rpm=60,
            retries=0, timeout=1,
        )
        for key, value in overrides.items():
            setattr(args, key, value)
        with patch.object(runner, "invoke", side_effect=invoke) as mock_invoke, \
                patch.object(runner.RateGate, "wait", return_value=None), \
                redirect_stdout(io.StringIO()):
            status = runner.run(
                args, samples, self.models, self.tokens,
                set(MODEL_IDS), set(PROMPT_IDS), {}, {}, self.output,
            )
        return status, mock_invoke

    @staticmethod
    def reply(text='{"caption":"offline response"}', finish_reason="stop"):
        return dict(text=text, finish_reason=finish_reason, prompt_applied=True,
                    usage={}, request_id="offline-request", warnings=[])

    def csv_rows(self):
        with (self.output / "results.csv").open(encoding="utf-8-sig", newline="") as handle:
            return list(csv.reader(handle))

    def statuses(self):
        return json.loads((self.output / "cell_status.json").read_text(encoding="utf-8"))

    def test_empty_stream_preserves_finish_reason_and_usage(self):
        from providers import _parse_stream
        event = {"choices": [{"index": 0, "delta": {}, "finish_reason": "length"}],
                 "usage": {"completion_tokens": 16384}}
        chunks = [("data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n").encode()]
        with self.assertRaises(APIError) as caught:
            _parse_stream(iter(chunks), "offline-empty")
        self.assertEqual(caught.exception.code, "empty_output")
        self.assertEqual(caught.exception.finish_reason, "length")
        self.assertEqual(caught.exception.usage, {"completion_tokens": 16384})

    def test_json_syntax_and_top_level_object_are_separate(self):
        self.assertEqual(runner.json_diagnostics('[]'), {"json_valid": True, "json_object_valid": False})
        self.assertEqual(runner.json_diagnostics('{"x": null}'), {"json_valid": True, "json_object_valid": True})
        for text in ['{"x": NaN}', '{"x": Infinity}', '{"x": -Infinity}']:
            self.assertEqual(runner.json_diagnostics(text), {"json_valid": False, "json_object_valid": False})

    def test_committed_case_selection_contains_exactly_30_audio_files(self):
        samples = load_dataset(
            config.DEFAULT_DATASET, manifest=config.ROOT / "cases.csv", expected_count=30,
        )
        self.assertEqual(len({sample.clip_id for sample in samples}), 30)
        self.assertEqual(len({sample.sha256 for sample in samples}), 30)
        self.assertEqual([m["id"] for m in self.models], MODEL_IDS)
        self.assertEqual(list(PROMPTS), PROMPT_IDS)
        self.assertEqual(
            [(p, m["id"]) for p, m in runner.column_specs(self.models)],
            [(p, m) for p in PROMPT_IDS for m in MODEL_IDS],
        )

    def test_30_cases_produce_60_requests_and_three_correctly_aligned_csv_columns(self):
        samples = self.samples(30)
        calls = []

        def inference(model, token, audio_bytes, system, user, timeout):
            payload = build_payload(model, audio_bytes, system, user)
            prompt_id = next(p for p in PROMPT_IDS if render_prompt(p) == system)
            audio_hash = hashlib.sha256(audio_bytes).hexdigest()
            text = json.dumps(dict(model=model["id"], prompt=prompt_id,
                                   audio=audio_hash, caption='引号 " 和逗号,\n换行'),
                              ensure_ascii=False)
            calls.append((audio_hash, prompt_id, model["id"], payload, audio_bytes))
            return self.reply(text)

        status, mocked = self.run_batch(samples, inference)
        self.assertEqual(status, 0)
        self.assertEqual(mocked.call_count, 60)
        self.assertEqual(Counter((a, p, m) for a, p, m, _, _ in calls),
                         Counter((s.sha256, p, m) for s in samples
                                 for p in PROMPT_IDS for m in MODEL_IDS))
        rows = self.csv_rows()
        headers = ["音频链接"] + [PROMPT_LABELS[p] + "｜" + m["label"]
                                 for p in PROMPT_IDS for m in self.models]
        self.assertEqual(rows[0], headers)
        self.assertEqual(len(rows), 31)
        self.assertTrue(all(len(row) == 3 for row in rows))
        for row, sample in zip(rows[1:], samples):
            self.assertEqual(row[0], sample.audio_url)
            for text, (prompt_id, model) in zip(row[1:], runner.column_specs(self.models)):
                parsed = json.loads(text)
                self.assertEqual((parsed["audio"], parsed["prompt"], parsed["model"]),
                                 (sample.sha256, prompt_id, model["id"]))
        self.assertEqual(Counter(cell["status"] for cell in self.statuses()), {"ok": 60})

        grouped = defaultdict(list)
        for audio_hash, prompt_id, model_id, payload, audio_bytes in calls:
            system = payload["messages"][0]
            self.assertEqual(system, {"role": "system", "content": render_prompt(prompt_id)})
            content = payload["messages"][1]["content"]
            encoded = content[0]["input_audio"]["data"]
            if model_id == "qwen35_plus":
                self.assertTrue(encoded.startswith("data:;base64,"))
                encoded = encoded.split(",", 1)[1]
            else:
                self.assertFalse(encoded.startswith("data:"))
            self.assertEqual(base64.b64decode(encoded, validate=True), audio_bytes)
            grouped[(audio_hash, prompt_id)].append((system, content[1], audio_bytes))
        for pair in grouped.values():
            self.assertEqual(len(pair), 2)
            self.assertEqual(pair[0], pair[1], "Models must receive the same prompt and audio")

    def test_resume_does_not_repeat_successful_requests(self):
        samples = self.samples()
        status, first = self.run_batch(samples, lambda *args: self.reply())
        self.assertEqual((status, first.call_count), (0, 2))
        original = (self.output / "results.csv").read_bytes()
        status, resumed = self.run_batch(samples, lambda *args: self.fail("Cached request repeated"))
        self.assertEqual((status, resumed.call_count), (0, 0))
        self.assertEqual((self.output / "results.csv").read_bytes(), original)

    def test_invalid_json_is_retained_verbatim_and_is_not_retried_on_resume(self):
        samples = self.samples()
        raw = '前导文本\n{"caption": "原始,响应\n含未转义换行"}\n尾部'
        status, first = self.run_batch(samples, lambda *args: self.reply(raw))
        self.assertEqual((status, first.call_count), (0, 2))
        self.assertEqual(self.csv_rows()[1][1:], [raw] * 2)
        self.assertTrue(all(cell["json_valid"] is False for cell in self.statuses()))
        for path in (self.output / "responses").glob("*.json"):
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["text"], raw)
        _, resumed = self.run_batch(samples, lambda *args: self.fail("Invalid JSON was regenerated"))
        self.assertEqual(resumed.call_count, 0)

    def test_api_failure_leaves_blank_cell_with_separate_error_and_only_failure_resumes(self):
        samples = self.samples()

        def inference(model, token, audio, system, user, timeout):
            if model["id"] == MODEL_IDS[0] and system == render_prompt("wynn"):
                raise APIError("offline rejected " + token, status=400,
                               code="unsupported_parameter", request_id="offline-failure")
            return self.reply()

        status, first = self.run_batch(samples, inference)
        self.assertEqual((status, first.call_count), (2, 2))
        self.assertEqual(self.csv_rows()[1][1], "")
        self.assertTrue(all(self.csv_rows()[1][2:]))
        failures = [cell for cell in self.statuses() if cell["status"] == "error"]
        self.assertEqual(len(failures), 1)
        detail = json.loads((self.output / "responses" /
                             (failures[0]["request_hash"] + ".json")).read_text(encoding="utf-8"))
        self.assertEqual(detail["error_code"], "unsupported_parameter")
        self.assertEqual(detail["http_status"], 400)
        self.assertEqual(detail["request_id"], "offline-failure")
        self.assertIn("[REDACTED]", detail["error"])
        self.assertNotIn(self.tokens[MODEL_IDS[0]], json.dumps(detail))
        status, resumed = self.run_batch(samples, lambda *args: self.reply())
        self.assertEqual((status, resumed.call_count), (0, 1))
        self.assertTrue(all(self.csv_rows()[1][1:]))
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertEqual(summary["attempts"], 3)
        history = [json.loads(line) for line in (self.output / "attempt_history.jsonl").read_text().splitlines()]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["error_code"], "unsupported_parameter")

    def test_prompt_change_invalidates_only_affected_prompt_requests(self):
        samples = self.samples()
        self.run_batch(samples, lambda *args: self.reply())
        old_keys = {cell["request_hash"] for cell in self.statuses()}
        with patch.dict(PROMPTS, {"wynn": PROMPTS["wynn"] + "\n离线测试变更"}):
            status, second = self.run_batch(samples, lambda *args: self.reply())
            new_keys = {cell["request_hash"] for cell in self.statuses()}
        self.assertEqual((status, second.call_count), (0, 2))
        self.assertEqual(len(old_keys & new_keys), 0)
        self.assertTrue(all(call.args[3].endswith("离线测试变更") for call in second.call_args_list))

    def test_model_change_invalidates_only_affected_model_requests(self):
        samples = self.samples()
        self.run_batch(samples, lambda *args: self.reply())
        old_keys = {cell["request_hash"] for cell in self.statuses()}
        self.models[0] = dict(self.models[0], model="audio-seed-lite-updated-for-offline-test")
        status, second = self.run_batch(samples, lambda *args: self.reply())
        new_keys = {cell["request_hash"] for cell in self.statuses()}
        self.assertEqual((status, second.call_count), (0, 1))
        self.assertEqual(len(old_keys & new_keys), 1)
        self.assertTrue(all(call.args[0]["id"] == MODEL_IDS[0] for call in second.call_args_list))

    def test_reference_answers_file_names_and_dataset_categories_are_not_sent(self):
        sample = self.samples()[0]
        secrets = ["PRIVATE_REFERENCE_TRANSCRIPT", "PRIVATE_CATEGORY_ANSWER",
                   "PRIVATE_CAPTION_ANSWER", "PRIVATE_EXPLICIT_ASR", "PRIVATE_EXPLICIT_LYRICS",
                   "private-source.example.test", "PRIVATE_FILENAME", "PRIVATE_CASE_ID"]
        for prompt_id, model in runner.column_specs(self.models):
            task = runner.task_for(sample, prompt_id, model, use_references=False)
            payload = build_payload(model, sample.path.read_bytes(), task["system"], task["user"])
            serialized = json.dumps(payload, ensure_ascii=False)
            for secret in secrets:
                self.assertNotIn(secret, serialized)
            self.assertIn('"duration_s":0.01', task["user"])
            self.assertIn('"channels":1', task["user"])
            self.assertIn("REF_ASR：未提供", task["user"])
            self.assertIn("REF_LYRICS：未提供", task["user"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
