"""Local ASR worker. Downloads the chosen model on first use. No provider API key needed."""
import json
import os
import sys
from faster_whisper import WhisperModel

if len(sys.argv) != 3:
    raise SystemExit("Usage: transcribe.py INPUT_MEDIA OUTPUT_JSON")
model = WhisperModel(os.getenv("WHISPER_MODEL", "base"), device=os.getenv("WHISPER_DEVICE", "cpu"), compute_type="int8")
segments, info = model.transcribe(sys.argv[1], beam_size=5, vad_filter=True)
result = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments if s.text.strip()]
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump({"segments": result, "language": info.language}, handle, ensure_ascii=False)
