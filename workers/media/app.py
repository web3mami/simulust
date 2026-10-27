"""Simulust media worker: images and image-to-video on one GPU.

HTTP contract (the app side lives in src/server/images.ts and src/server/video.ts):

  POST /v1/images      { prompt, negative_prompt, width, height, seed, lora, style }
                       -> 200 image bytes (X-Seed header) | 422 {"error":"blocked","reason"}
  POST /v1/videos      { job_id, image (base64), image_mime_type, prompt, negative_prompt,
                         seconds, style?, callback_url } -> 202 { job_id, status }
                       | 422 {"error":"blocked","reason"}
  GET  /v1/videos/{id} -> { job_id, status, video_base64?, mime_type?, frames?, error? }
                       A job the worker's safety checks refused ends "failed" with
                       error "blocked: <reason>".
  GET  /health         -> { ok, anime_tagger, ... } (no auth, for load balancers)

Every /v1 call needs "Authorization: Bearer $API_KEY". When a video job ends, the
worker POSTs the GET body to callback_url with the same header, leaving out
video_base64 and frames when it is over CALLBACK_MAX_BYTES; the app then GETs the
job. Untested on a GPU; see README.md.
"""

from __future__ import annotations

import base64
import hmac
import io
import json
import logging
import os
import queue
import random
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, Response
from PIL import Image
from pydantic import BaseModel, Field

from models import FAKE, BadRequest, Busy, ImageModels, VideoModel, decode_image, encode_image
from safety import screen_negative, screen_prompt, tagger_from_env

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("media-worker")

API_KEY = os.environ.get("API_KEY", "")
if not API_KEY and os.environ.get("ALLOW_NO_AUTH") != "1":
    raise SystemExit("Set API_KEY (the app's IMAGE_API_KEY / VIDEO_API_KEY), or ALLOW_NO_AUTH=1 for local tests.")

ENABLE_IMAGES = os.environ.get("ENABLE_IMAGES", "1") == "1"
ENABLE_VIDEO = os.environ.get("ENABLE_VIDEO", "1") == "1"
OUTPUT_FORMAT = os.environ.get("OUTPUT_FORMAT", "jpeg")  # jpeg | png | webp
# Callbacks only go to the app. Set this to APP_URL so a stolen key can't make
# the worker POST to arbitrary hosts.
CALLBACK_PREFIX = os.environ.get("CALLBACK_PREFIX", "")
MAX_QUEUE = int(os.environ.get("MAX_QUEUE", "20"))
RESULT_TTL = int(os.environ.get("RESULT_TTL_SECONDS", "3600"))
# Image requests wait this long for the GPU (a video may be rendering) before
# answering 503, so the app can refund well inside its own timeout.
IMAGE_WAIT = float(os.environ.get("IMAGE_WAIT_SECONDS", "60"))
# Vercel refuses request bodies over 4.5 MB, and a 720p clip plus its frames in
# base64 can come close.
CALLBACK_MAX_BYTES = int(os.environ.get("CALLBACK_MAX_BYTES", "4000000"))

MIME = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

images = ImageModels()
video = VideoModel()
tagger = tagger_from_env()
# The tagger checks every image, video source and clip whatever style the caller
# declares: a leaked key could declare the unchecked one, and gets its results
# straight back, past the app's Hive checks. With real models the worker refuses
# all work while it is off; only the CPU contract check (FAKE_MODELS=1) runs
# without it.
CHECKED = tagger is not None or FAKE
if not CHECKED:
    log.error("ANIME_TAGGER=0 with real models: every image and video is refused")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if ENABLE_VIDEO:
        threading.Thread(target=_run_videos, daemon=True, name="video-jobs").start()
    if tagger is not None:
        try:
            tagger.flagged([])  # Loads it, so the first request doesn't wait for the download.
        except Exception:  # noqa: BLE001 - requests retry the load and fail closed meanwhile
            log.exception("The tagger didn't load")
    for name in [part.strip() for part in os.environ.get("PRELOAD", "").split(",") if part.strip()]:
        if name in ("realistic", "anime") and ENABLE_IMAGES:
            images.pipe(name)
        elif name == "video" and ENABLE_VIDEO:
            video.pipe()
    yield


app = FastAPI(title="Simulust media worker", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def require_key(authorization: str = Header(default="")) -> None:
    if not API_KEY:
        return
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(token.encode(), API_KEY.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


def error(status: int, message: str, **extra) -> JSONResponse:
    return JSONResponse({"error": message, **extra}, status_code=status)


def apparent_minor(stills: List[Image.Image]) -> Optional[str]:
    """Why an image or clip is refused, or None. Raises when the tagger can't run."""
    if tagger is None:  # FAKE_MODELS=1 only (see CHECKED).
        return None
    if not stills:
        raise RuntimeError("no images to check")
    flagged = tagger.flagged(stills)
    return f"apparent minor: {', '.join(flagged)}" if flagged else None


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=4000)
    width: int = Field(ge=256, le=1536)
    height: int = Field(ge=256, le=1536)
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)
    lora: Optional[str] = Field(default=None, max_length=64)
    style: str = Field(pattern="^(realistic|anime)$")


@app.post("/v1/images", dependencies=[Depends(require_key)])
def create_image(body: ImageRequest):
    if not ENABLE_IMAGES:
        return error(404, "images are disabled on this worker")
    if not CHECKED:
        return error(503, "safety check is off")
    reason = screen_prompt(body.prompt) or screen_negative(body.negative_prompt)
    if reason:
        log.warning("Refused image prompt (%s)", reason)
        return error(422, "blocked", reason=reason)

    seed = body.seed if body.seed is not None else random.randint(0, 2**31 - 1)
    width, height = body.width // 16 * 16, body.height // 16 * 16
    try:
        image = images.generate(
            style=body.style,
            prompt=body.prompt,
            negative_prompt=body.negative_prompt,
            width=width,
            height=height,
            seed=seed,
            lora=body.lora,
            wait=IMAGE_WAIT,
        )
    except Busy:
        return error(503, "busy")
    except BadRequest as bad:
        return error(400, str(bad))
    except Exception:  # noqa: BLE001
        log.exception("Image generation failed")
        return error(500, "generation failed")

    try:
        reason = apparent_minor([image])
    except Exception:  # noqa: BLE001 - an unchecked image never leaves
        log.exception("Tagger failed")
        return error(503, "safety check unavailable")
    if reason:
        log.warning("Refused %s image: %s", body.style, reason)
        return error(422, "blocked", reason=reason)

    return Response(
        content=encode_image(image, OUTPUT_FORMAT),
        media_type=MIME.get(OUTPUT_FORMAT, "image/jpeg"),
        headers={"X-Seed": str(seed), "Cache-Control": "no-store"},
    )


class VideoRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9:_-]+$")
    image: str = Field(min_length=100, max_length=40_000_000)
    image_mime_type: Optional[str] = None
    prompt: str = Field(default="", max_length=2000)
    negative_prompt: str = Field(default="", max_length=4000)
    seconds: int = Field(default=5, ge=1, le=8)
    # The source image's declared style, for the logs: every clip is checked.
    style: Optional[str] = Field(default=None, pattern="^(realistic|anime)$")
    callback_url: Optional[str] = Field(default=None, max_length=2000)


@dataclass
class Job:
    job_id: str
    request: VideoRequest
    status: str = "queued"
    created: float = field(default_factory=time.time)
    finished: Optional[float] = None
    video_base64: Optional[str] = None
    frames: List[str] = field(default_factory=list)
    error: Optional[str] = None

    def payload(self, media: bool = True) -> dict:
        body: dict = {"job_id": self.job_id, "status": self.status}
        if self.status == "succeeded" and media:
            body.update(video_base64=self.video_base64, mime_type="video/mp4", frames=self.frames)
        if self.error:
            body["error"] = self.error
        return body


jobs: Dict[str, Job] = {}
jobs_lock = threading.Lock()
work: "queue.Queue[str]" = queue.Queue(maxsize=MAX_QUEUE)


@app.post("/v1/videos", status_code=202, dependencies=[Depends(require_key)])
def create_video(body: VideoRequest):
    if not ENABLE_VIDEO:
        return error(404, "video is disabled on this worker")
    if not CHECKED:
        return error(503, "safety check is off")
    if body.callback_url and CALLBACK_PREFIX and not body.callback_url.startswith(CALLBACK_PREFIX):
        return error(400, "callback_url is not allowed")
    reason = screen_prompt(body.prompt) or screen_negative(body.negative_prompt)
    if reason:
        log.warning("Refused video prompt (%s)", reason)
        return error(422, "blocked", reason=reason)
    with jobs_lock:
        existing = jobs.get(body.job_id)
        if existing:  # Retried submit: same job, no second render.
            return JSONResponse({"job_id": existing.job_id, "status": existing.status}, status_code=202)
        try:
            work.put_nowait(body.job_id)
        except queue.Full:
            return error(503, "busy")
        jobs[body.job_id] = Job(job_id=body.job_id, request=body)
    return {"job_id": body.job_id, "status": "queued"}


@app.get("/v1/videos/{job_id}", dependencies=[Depends(require_key)])
def get_video(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return error(404, "unknown job")
    return job.payload()


@app.get("/health")
def health():
    info: dict = {"ok": True, "fake": FAKE, "images": ENABLE_IMAGES, "video": ENABLE_VIDEO, "queued": work.qsize()}
    info["anime_tagger"] = tagger is not None
    info["loaded"] = images.loaded() + (["video"] if video.loaded() else [])
    info["lora"] = images.lora_support()
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            info["gpu"] = {"name": torch.cuda.get_device_name(0), "free_gb": round(free / 1e9, 1), "total_gb": round(total / 1e9, 1)}
    except Exception:  # noqa: BLE001 - health must not fail on a missing torch
        pass
    return info


def _deliver(job: Job) -> None:
    url = job.request.callback_url
    if not url:
        return
    full = json.dumps(job.payload()).encode()
    short = json.dumps(job.payload(media=False)).encode()
    # Too big, it goes without the clip and frames, and the app GETs the job.
    body = full if len(full) <= CALLBACK_MAX_BYTES else short
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    delays = [0, 5, 15, 45, 120, 300]
    for attempt, delay in enumerate(delays):
        time.sleep(delay)
        try:
            response = httpx.post(url, content=body, headers=headers, timeout=180)
            if response.status_code < 300:
                return
            # A proxy in front of the app with a lower limit than ours.
            if response.status_code == 413 and body != short:
                log.warning("Callback for %s was too large; sending it without the clip", job.job_id)
                body = short
                continue
            # 4xx other than 409 won't get better by retrying.
            if 400 <= response.status_code < 500 and response.status_code != 409:
                log.error("Callback for %s rejected: %s %s", job.job_id, response.status_code, response.text[:200])
                return
            log.warning("Callback for %s got %s (attempt %d)", job.job_id, response.status_code, attempt + 1)
        except httpx.HTTPError as failure:
            log.warning("Callback for %s failed: %s (attempt %d)", job.job_id, failure, attempt + 1)
    log.error("Giving up on callback for %s; the app will poll GET /v1/videos/%s", job.job_id, job.job_id)


def _purge() -> None:
    cutoff = time.time() - RESULT_TTL
    with jobs_lock:
        for job_id in [key for key, job in jobs.items() if job.finished and job.finished < cutoff]:
            del jobs[job_id]


def _video_refusal(stills: List[Image.Image], checked: str) -> Optional[str]:
    """apparent_minor for a video job, which fails when the tagger can't run.
    The reason says what was checked ("source" or "frames"), since only a hit on
    the source photo says anything about the photo the app keeps."""
    try:
        reason = apparent_minor(stills)
    except Exception as failure:  # noqa: BLE001 - an unchecked clip never succeeds
        raise RuntimeError("safety check unavailable") from failure
    return reason.replace("apparent minor:", f"apparent minor ({checked}):", 1) if reason else None


def _run_videos() -> None:
    while True:
        job_id = work.get()
        _purge()
        with jobs_lock:
            job = jobs.get(job_id)
        if not job:
            continue
        job.status = "running"
        try:
            source = decode_image(job.request.image)
            # With a leaked key the source can be any picture, so it is checked
            # before the GPU spends minutes on it.
            reason = _video_refusal([source], "source")
            if reason is None:
                result = video.generate(
                    image=source,
                    prompt=job.request.prompt,
                    negative_prompt=job.request.negative_prompt,
                    seconds=job.request.seconds,
                    seed=random.randint(0, 2**31 - 1),
                )
                # A clip can drift younger than its source. These are the stills
                # the app sends to Hive.
                reason = _video_refusal([Image.open(io.BytesIO(frame)) for frame in result.frames], "frames")
                if reason is None:
                    job.video_base64 = base64.b64encode(result.mp4).decode()
                    job.frames = [base64.b64encode(frame).decode() for frame in result.frames]
                    job.status = "succeeded"
            if reason:
                log.warning("Refused video %s (declared %s): %s", job_id, job.request.style, reason)
                job.status, job.error = "failed", f"blocked: {reason}"[:500]
        except BadRequest as bad:
            job.status, job.error = "failed", str(bad)
        except Exception as failure:  # noqa: BLE001
            log.exception("Video job %s failed", job_id)
            job.status, job.error = "failed", f"{type(failure).__name__}: {failure}"[:500]
        finally:
            job.finished = time.time()
            job.request.image = ""  # The source image isn't needed any more.
        threading.Thread(target=_deliver, args=(job,), daemon=True).start()
