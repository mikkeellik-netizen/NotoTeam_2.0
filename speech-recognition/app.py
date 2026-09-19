import asyncio
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from faster_whisper import WhisperModel


def positive_int(name: str, fallback: int) -> int:
    try:
        value = int(os.getenv(name, str(fallback)))
        return value if value > 0 else fallback
    except ValueError:
        return fallback


MODEL_NAME = os.getenv("SPEECH_MODEL", "small").strip() or "small"
MODEL_ROOT = os.getenv("SPEECH_MODEL_ROOT", "/models")
DEVICE = os.getenv("SPEECH_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("SPEECH_COMPUTE_TYPE", "int8")
LANGUAGE = os.getenv("SPEECH_LANGUAGE", "ru").strip() or None
MAX_FILE_BYTES = positive_int("SPEECH_MAX_FILE_BYTES", 20 * 1024 * 1024)
CPU_THREADS = positive_int("SPEECH_CPU_THREADS", max(1, os.cpu_count() or 1))
MAX_CONCURRENT = positive_int("SPEECH_MAX_CONCURRENT", 1)

app = FastAPI(title="NotoTime local speech recognition", docs_url=None, redoc_url=None)
semaphore = asyncio.Semaphore(MAX_CONCURRENT)
model = WhisperModel(
    MODEL_NAME,
    device=DEVICE,
    compute_type=COMPUTE_TYPE,
    cpu_threads=CPU_THREADS,
    download_root=MODEL_ROOT,
    local_files_only=True,
)


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE, "computeType": COMPUTE_TYPE}


def recognize(path: str) -> tuple[str, str | None, float | None]:
    segments, info = model.transcribe(
        path,
        language=LANGUAGE,
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    return text, getattr(info, "language", None), getattr(info, "language_probability", None)


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict[str, object]:
    suffix = Path(file.filename or "voice.ogg").suffix.lower()
    if suffix not in {".ogg", ".oga", ".opus", ".mp3", ".wav", ".m4a", ".mp4", ".webm"}:
        suffix = ".ogg"

    temp_path: str | None = None
    total = 0
    try:
        with tempfile.NamedTemporaryFile(prefix="nototime-voice-", suffix=suffix, delete=False) as target:
            temp_path = target.name
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_FILE_BYTES:
                    raise HTTPException(status_code=413, detail="Audio file is too large")
                target.write(chunk)

        if total == 0:
            raise HTTPException(status_code=400, detail="Audio file is empty")

        async with semaphore:
            text, language, probability = await run_in_threadpool(recognize, temp_path)
        if not text:
            raise HTTPException(status_code=422, detail="Speech was not recognized")

        return {
            "text": text,
            "language": language,
            "languageProbability": probability,
        }
    finally:
        await file.close()
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)
