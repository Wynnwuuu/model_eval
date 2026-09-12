"""Load local WAV datasets without exposing reference labels to model adapters.

``load_dataset(root)`` prefers manifest.jsonl, then manifest.csv, and otherwise
finds WAV files recursively. Manifest ordering is retained. The ``audio_url``
field identifies the *evaluated clip*: a manifest ``audio_url`` when supplied,
otherwise a local file URI. ``source_url`` is deliberately never substituted,
because source pages may describe uncropped or entirely different audio.
"""

from __future__ import annotations

import csv
import hashlib
import json
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


class DatasetError(ValueError):
    """A missing, ambiguous, unsafe, or inconsistent dataset input."""


@dataclass(frozen=True)
class AudioSample:
    clip_id: str
    path: Path
    relative_path: str
    audio_url: str
    duration_seconds: float
    sample_rate: int
    channels: int
    sample_width: int
    frame_count: int
    sha256: str
    size_bytes: int
    ref_asr: str = ""
    ref_lyrics: str = ""
    # Evaluation/reference metadata must never be forwarded wholesale to models.
    metadata: dict[str, Any] = field(default_factory=dict, compare=False, repr=False)

    @property
    def local_path(self) -> Path:
        return self.path

    @property
    def mime_type(self) -> str:
        return "audio/wav"


def _rows(manifest: Path) -> list[dict[str, Any]]:
    try:
        with manifest.open("r", encoding="utf-8-sig", newline="") as handle:
            if manifest.suffix.lower() == ".csv":
                reader = csv.DictReader(handle)
                if not reader.fieldnames:
                    raise DatasetError(f"Manifest has no header: {manifest}")
                if len(set(reader.fieldnames)) != len(reader.fieldnames):
                    raise DatasetError(f"Manifest has duplicate columns: {manifest}")
                records: list[dict[str, Any]] = list(reader)
            elif manifest.suffix.lower() == ".jsonl":
                records = []
                for line_number, line in enumerate(handle, 1):
                    if not line.strip():
                        continue
                    record = json.loads(line)
                    if not isinstance(record, dict):
                        raise DatasetError(
                            f"Expected a JSON object at {manifest}:{line_number}"
                        )
                    records.append(record)
            else:
                raise DatasetError("Manifest must use .jsonl or .csv")
    except (OSError, UnicodeError, csv.Error, json.JSONDecodeError) as exc:
        raise DatasetError(f"Cannot read manifest {manifest}: {exc}") from exc
    if not records:
        raise DatasetError(f"Manifest is empty: {manifest}")
    return records


def _local_path(root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise DatasetError("Every manifest record requires a local 'file' path")
    # Manifests are portable and rooted in the dataset, never absolute paths.
    relative = Path(value)
    if relative.is_absolute() or ".." in relative.parts:
        raise DatasetError(f"Audio path must stay relative to dataset root: {value!r}")
    path = (root / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise DatasetError(f"Audio symlink escapes dataset root: {value!r}") from exc
    if not path.is_file():
        raise DatasetError(f"Audio file does not exist: {value!r}")
    if path.suffix.lower() != ".wav":
        raise DatasetError(f"Expected WAV audio; convert this file first: {value!r}")
    return path


def _wav_info(path: Path) -> tuple[float, int, int, int, int]:
    try:
        with wave.open(str(path), "rb") as audio:
            frames = audio.getnframes()
            rate = audio.getframerate()
            channels = audio.getnchannels()
            width = audio.getsampwidth()
            if frames <= 0 or rate <= 0 or channels <= 0 or width <= 0:
                raise DatasetError(f"WAV contains no usable audio: {path}")
            if audio.getcomptype() != "NONE":
                raise DatasetError(f"WAV must use uncompressed PCM audio: {path}")
            # A valid header alone does not prove the PCM payload is complete.
            bytes_read = 0
            while chunk := audio.readframes(65536):
                bytes_read += len(chunk)
            if bytes_read != frames * channels * width:
                raise DatasetError(f"WAV payload is truncated: {path}")
            return frames / rate, rate, channels, width, frames
    except (OSError, EOFError, wave.Error) as exc:
        raise DatasetError(f"Cannot read WAV {path}: {exc}") from exc


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _text(record: dict[str, Any], key: str) -> str:
    value = record.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise DatasetError(f"Manifest field {key!r} must be text")
    return value


def load_dataset(
    root: str | Path,
    *,
    manifest: str | Path | None = None,
    expected_count: int | None = None,
    require_complete: bool = True,
    verify_manifest_hash: bool = True,
) -> list[AudioSample]:
    """Read a WAV dataset, validating uniqueness, payloads and actual hashes.

    ``manifest`` is an explicit CSV/JSONL filename (relative to root or absolute).
    By default every WAV beneath root must appear in the manifest exactly once;
    set ``require_complete=False`` for an intentional manifest subset. Set
    ``expected_count=100`` to enforce the size of clip-pack-100. Hashes are always
    freshly computed for resume fingerprints. An existing manifest sha256 is
    checked unless ``verify_manifest_hash=False`` is explicitly requested.

    Only explicitly supplied ``ref_asr`` and ``ref_lyrics`` are copied into those
    fields. ``transcript`` and source captions remain reference-only metadata.
    """
    root = Path(root).expanduser().resolve()
    if not root.is_dir():
        raise DatasetError(f"Dataset directory does not exist: {root}")
    if expected_count is not None and expected_count < 1:
        raise DatasetError("expected_count must be positive")

    chosen: Path | None = None
    if manifest is not None:
        chosen = Path(manifest).expanduser()
        if not chosen.is_absolute():
            chosen = root / chosen
    else:
        for name in ("manifest.jsonl", "manifest.csv"):
            if (root / name).is_file():
                chosen = root / name
                break

    discovered = sorted(
        (p for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".wav"),
        key=lambda p: p.relative_to(root).as_posix(),
    )
    records = (
        _rows(chosen)
        if chosen is not None
        else [{"file": p.relative_to(root).as_posix()} for p in discovered]
    )
    if not records:
        raise DatasetError(f"No WAV audio found in dataset: {root}")
    if expected_count is not None and len(records) != expected_count:
        raise DatasetError(f"Expected {expected_count} audio rows; found {len(records)}")

    samples: list[AudioSample] = []
    seen_ids: set[str] = set()
    seen_paths: set[Path] = set()
    for index, record in enumerate(records, 1):
        path = _local_path(root, record.get("file", record.get("path")))
        relative_path = path.relative_to(root).as_posix()
        # Relative stems retain uniqueness when different folders share filenames.
        clip_id = _text(record, "clip_id").strip() or str(Path(relative_path).with_suffix(""))
        if clip_id in seen_ids:
            raise DatasetError(f"Duplicate clip_id at manifest row {index}: {clip_id}")
        if path in seen_paths:
            raise DatasetError(f"Duplicate audio file at manifest row {index}: {relative_path}")
        seen_ids.add(clip_id)
        seen_paths.add(path)

        duration, rate, channels, width, frames = _wav_info(path)
        digest = _sha256(path)
        declared_hash = _text(record, "sha256").strip().lower()
        if verify_manifest_hash and declared_hash and declared_hash != digest:
            raise DatasetError(f"Manifest sha256 disagrees with current audio: {relative_path}")
        audio_url = _text(record, "audio_url").strip() or path.as_uri()
        parsed_url = urlsplit(audio_url)
        if parsed_url.scheme not in {"https", "http", "file"}:
            raise DatasetError(f"audio_url must be an HTTP(S) URL or file URI: {clip_id}")
        if parsed_url.scheme in {"https", "http"} and not parsed_url.netloc:
            raise DatasetError(f"audio_url has no hostname: {clip_id}")

        samples.append(
            AudioSample(
                clip_id=clip_id,
                path=path,
                relative_path=relative_path,
                audio_url=audio_url,
                duration_seconds=duration,
                sample_rate=rate,
                channels=channels,
                sample_width=width,
                frame_count=frames,
                sha256=digest,
                size_bytes=path.stat().st_size,
                ref_asr=_text(record, "ref_asr"),
                ref_lyrics=_text(record, "ref_lyrics"),
                metadata=dict(record),
            )
        )

    if require_complete:
        discovered_paths = {_local_path(root, p.relative_to(root).as_posix()) for p in discovered}
        omitted = discovered_paths - seen_paths
        if omitted:
            names = ", ".join(sorted(p.relative_to(root).as_posix() for p in omitted)[:5])
            raise DatasetError(f"Manifest omits {len(omitted)} WAV file(s): {names}")
    return samples
