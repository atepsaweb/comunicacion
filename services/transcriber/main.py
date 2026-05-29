import asyncio
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from faster_whisper import WhisperModel

MODEL_SIZE = os.getenv("WHISPER_MODEL", "medium")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT_JOBS", "2"))

app = FastAPI()
_semaphore: Optional[asyncio.Semaphore] = None
_model: Optional[WhisperModel] = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type=COMPUTE_TYPE)
    return _model


@app.on_event("startup")
async def startup() -> None:
    global _semaphore
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    # Warm up: cargar el modelo en memoria antes del primer request
    get_model()


class TranscribeRequest(BaseModel):
    path: str


class TranscribeResponse(BaseModel):
    text: str
    duration_sec: int
    model: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_SIZE}


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(req: TranscribeRequest) -> TranscribeResponse:
    path = Path(req.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.path}")
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    assert _semaphore is not None, "Semaphore not initialized"
    async with _semaphore:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _do_transcribe, str(path))

    return result


def _do_transcribe(path: str) -> TranscribeResponse:
    model = get_model()
    segments, info = model.transcribe(
        path,
        language="es",
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    text = " ".join(seg.text.strip() for seg in segments).strip()
    duration_sec = int(info.duration)
    return TranscribeResponse(text=text, duration_sec=duration_sec, model=MODEL_SIZE)
