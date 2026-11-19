#!/usr/bin/env python3
"""Check that a finished ad says what the script says.

    python3 content/pipeline/transcribe.py <video.mp4> <spot.json> --model <folder>

Transcribes the audio with Whisper (small, via sherpa-onnx, runs on a laptop
CPU) and compares it with the spot's lines, ignoring punctuation and accents.
Exit code 0 = the words match, 1 = they differ.

Setup, once:
    pip install sherpa-onnx numpy
    curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2
    tar xjf sherpa-onnx-whisper-small.tar.bz2        # pass this folder as --model

It checks WORDS only. Accent, tone and whether the voice suits the character
still need a person's ear.
"""
import argparse
import json
import re
import subprocess
import sys
import unicodedata


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text)).strip()


def audio(path: str, start: float, length: float):
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", str(start), "-t", str(length), "-i", path,
         "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("spot")
    parser.add_argument("--model", required=True, help="folder holding small-encoder.int8.onnx etc.")
    args = parser.parse_args()

    import sherpa_onnx

    model = args.model.rstrip("/") + "/"
    recogniser = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=model + "small-encoder.int8.onnx",
        decoder=model + "small-decoder.int8.onnx",
        tokens=model + "small-tokens.txt",
        language="es", task="transcribe", num_threads=4,
    )

    with open(args.spot, encoding="utf-8") as handle:
        spot = json.load(handle)

    # One pass per shot: the recogniser stops at the first long pause, so a
    # whole ad transcribed in one go loses everything after the first line.
    heard = []
    cursor = 0.0
    for shot in spot["shots"]:
        length = shot["out"] - shot["in"]
        stream = recogniser.create_stream()
        stream.accept_waveform(16000, audio(args.video, cursor, length))
        recogniser.decode_stream(stream)
        heard.append(stream.result.text.strip())
        cursor += length

    expected = normalise(" ".join(line["text"] for line in spot["lines"]))
    actual = normalise(" ".join(heard))
    print("script:", " ".join(line["text"] for line in spot["lines"]))
    print("heard: ", " ".join(heard))
    if expected == actual:
        print("OK: the spoken words match the script.")
        return 0
    print("MISMATCH: the spoken words differ from the script.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
