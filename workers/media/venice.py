"""Image-to-video on Venice's hosted models (VIDEO_BACKEND=venice), for the ones
with no public weights: Wan 2.7 Enhanced, Wan 3.0.

Same interface as models.VideoModel, so the job runner in app.py is unchanged
around it: the prompt screen and the tagger's check of the source photo run
before anything is sent, and the clip comes back here, is re-encoded without
its audio, and its sampled frames go through the tagger and on to the app's
Hive check like a local clip's. Whatever Venice or the model's provider refuse,
none of our checks counts on it.

Venice's flow (docs.venice.ai, video): POST /video/queue -> { queue_id,
download_url? }; POST /video/retrieve until it answers with the video (or
"COMPLETED", when download_url is where the video is); then POST
/video/complete, and DELETE download_url, so Venice drops its copy.
"""

from __future__ import annotations

import base64
import logging
import math
import os
import subprocess
import tempfile
import time
from typing import List, Optional

import httpx
from PIL import Image

from models import FAKE, BadRequest, VideoResult, _fake_video, encode_image, negative, sample_frames

log = logging.getLogger("media-worker.venice")

VENICE_API_URL = os.environ.get("VENICE_API_URL", "https://api.venice.ai/api/v1").rstrip("/")
VENICE_API_KEY = os.environ.get("VENICE_API_KEY", "")
VENICE_VIDEO_MODEL = os.environ.get("VENICE_VIDEO_MODEL", "wan-2-7-enhanced-image-to-video")
VENICE_VIDEO_RESOLUTION = os.environ.get("VENICE_VIDEO_RESOLUTION", "720p")
# Under the app's 20 minutes, after which it refunds whatever the worker says.
VENICE_TIMEOUT = float(os.environ.get("VENICE_TIMEOUT_SECONDS", "900"))
# Venice asks for polls about every 5 seconds.
POLL_SECONDS = float(os.environ.get("VENICE_POLL_SECONDS", "5"))
# Stills for the tagger and Hive: 6 per 5 seconds, as from a Wan 2.2 clip.
STILLS_PER_5S = 6
# Statuses worth another try: rate limits, capacity, a flaky gateway.
RETRY = {429, 500, 502, 503, 504}


class VeniceVideo:
    def __init__(self, client=None) -> None:
        if not VENICE_API_KEY and not FAKE:
            raise SystemExit("VIDEO_BACKEND=venice needs VENICE_API_KEY.")
        self._client = client

    @property
    def name(self) -> str:
        return f"venice:{VENICE_VIDEO_MODEL}"

    def loaded(self) -> bool:
        return True

    def lora_info(self) -> Optional[dict]:
        return None

    def pipe(self):  # Nothing to load: PRELOAD=video is a no-op.
        return None

    def client(self):
        if self._client is None:
            self._client = httpx.Client(
                base_url=VENICE_API_URL,
                headers={"Authorization": f"Bearer {VENICE_API_KEY}"},
                timeout=120,
            )
        return self._client

    def generate(self, *, image: Image.Image, prompt: str, negative_prompt: str, seconds: int, seed: int) -> VideoResult:
        if FAKE:
            return _fake_video(image, seconds)
        # No seed: Venice's video API takes none. No aspect_ratio either: Wan
        # 2.7 Enhanced takes it from the image. No audio flag: the audio is
        # dropped below whatever the model makes.
        body = {
            "model": VENICE_VIDEO_MODEL,
            "prompt": prompt,
            "negative_prompt": negative(negative_prompt),
            "image_url": "data:image/jpeg;base64," + base64.b64encode(encode_image(image, "jpeg")).decode(),
            "duration": f"{seconds}s",
            "resolution": VENICE_VIDEO_RESOLUTION,
        }
        queued = self._json(self._post("/video/queue", body))
        queue_id = queued.get("queue_id")
        if not isinstance(queue_id, str) or not queue_id:
            raise RuntimeError("Venice queued the clip without a queue_id")
        download_url = queued.get("download_url") if isinstance(queued.get("download_url"), str) else None
        try:
            clip = self._wait(queue_id, download_url)
        finally:
            self._release(queue_id, download_url)
        mp4, stills = silent_h264(clip, STILLS_PER_5S * max(1, math.ceil(seconds / 5)))
        return VideoResult(mp4=mp4, frames=sample_frames(stills, count=len(stills)))

    def _wait(self, queue_id: str, download_url: Optional[str]) -> bytes:
        deadline = time.monotonic() + VENICE_TIMEOUT
        while True:
            response = self._post("/video/retrieve", {"model": VENICE_VIDEO_MODEL, "queue_id": queue_id})
            if response.headers.get("content-type", "").startswith("video/"):
                return response.content
            status = self._json(response).get("status")
            if status == "COMPLETED":
                if not download_url:
                    raise RuntimeError("Venice finished the clip but sent no video")
                return self._download(download_url)
            if status != "PROCESSING":
                raise RuntimeError(f"Venice sent an unknown status: {str(status)[:50]}")
            if time.monotonic() > deadline:
                raise RuntimeError(f"Venice didn't finish the clip in {VENICE_TIMEOUT:.0f} s")
            time.sleep(POLL_SECONDS)

    def _download(self, url: str) -> bytes:
        # A pre-signed URL: no key, and Venice warns that many fetches from many
        # addresses get refused, so only a few tries.
        for attempt in range(3):
            try:
                response = httpx.get(url, timeout=120)
                if response.status_code == 200:
                    return response.content
                if response.status_code not in RETRY:
                    raise RuntimeError(f"Venice download {response.status_code}")
            except httpx.TransportError as failure:
                log.warning("Venice download failed: %s (attempt %d)", failure, attempt + 1)
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
        raise RuntimeError("Venice download kept failing")

    def _release(self, queue_id: str, download_url: Optional[str]) -> None:
        """Asks Venice to drop its copy of the clip. A failure only leaves it there
        until it expires (24 hours), so it is logged, never raised."""
        try:
            response = self.client().post("/video/complete", json={"queue_id": queue_id})
            if response.status_code >= 300:
                log.warning("Venice kept clip %s: complete answered %s", queue_id, response.status_code)
            if download_url:
                httpx.delete(download_url, timeout=30)
        except Exception as failure:  # noqa: BLE001 - cleanup must not fail the job
            log.warning("Venice cleanup for %s failed: %s", queue_id, failure)

    def _post(self, path: str, body: dict):
        """POSTs to Venice, retrying rate limits and outages. A refusal under its
        or the model provider's content policy (422) is BadRequest, which fails
        the job like a bad request; the app refunds it as a failed render. It is
        no verdict of ours, so it isn't "blocked:" and logs no moderation event."""
        for attempt in range(4):
            try:
                response = self.client().post(path, json=body)
            except httpx.TransportError as failure:
                if attempt == 3:
                    raise RuntimeError(f"Venice unreachable: {failure}") from failure
                time.sleep(5 * 2**attempt)
                continue
            if response.status_code < 300:
                return response
            detail = _detail(response)
            if response.status_code == 422:
                raise BadRequest(f"Venice refused the clip: {detail}")
            if response.status_code == 400:
                raise BadRequest(f"Venice rejected the request: {detail}")
            if response.status_code in RETRY and attempt < 3:
                log.warning("Venice %s answered %s (attempt %d)", path, response.status_code, attempt + 1)
                time.sleep(5 * 2**attempt)
                continue
            # 401/402/403: the key, the balance or the region; 404: the clip is gone.
            raise RuntimeError(f"Venice {path} {response.status_code}: {detail}")
        raise RuntimeError(f"Venice {path} kept failing")

    @staticmethod
    def _json(response) -> dict:
        try:
            body = response.json()
        except ValueError as failure:
            raise RuntimeError("Venice sent something other than JSON") from failure
        return body if isinstance(body, dict) else {}


def _detail(response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text[:300]
    if isinstance(body, dict):
        body = body.get("error") or body.get("message") or body.get("details") or body
    return str(body)[:300]


def silent_h264(clip: bytes, count: int) -> "tuple[bytes, List[Image.Image]]":
    """The clip re-encoded as H.264 without audio or metadata, and `count` evenly
    spaced stills of it, first and last included.

    Re-encoded because Venice may send H.265, which most browsers won't play;
    without audio because nothing checks a clip's sound, and our clips had
    none until now."""
    import imageio_ffmpeg

    with tempfile.TemporaryDirectory() as folder:
        source, output = os.path.join(folder, "venice.mp4"), os.path.join(folder, "clip.mp4")
        with open(source, "wb") as handle:
            handle.write(clip)
        command = [
            imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-loglevel", "error", "-y", "-i", source,
            "-map", "0:v:0", "-an", "-map_metadata", "-1", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", output,
        ]  # fmt: skip
        result = subprocess.run(command, capture_output=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"Venice clip didn't decode: {result.stderr.decode(errors='replace')[-300:]}")
        total, _ = imageio_ffmpeg.count_frames_and_secs(output)
        if total < 1:
            raise RuntimeError("Venice clip has no frames")
        count = min(count, total)
        picks = {round(i * (total - 1) / max(1, count - 1)) for i in range(count)}
        stills: List[Image.Image] = []
        frames = imageio_ffmpeg.read_frames(output)
        try:
            size = next(frames)["size"]
            last, index = None, -1
            for index, frame in enumerate(frames):
                last = frame
                if index in picks:
                    stills.append(Image.frombytes("RGB", size, frame))
            # Fewer frames than the count said: the clip's end is still checked.
            if last is not None and index < max(picks):
                stills.append(Image.frombytes("RGB", size, last))
        finally:
            frames.close()
        with open(output, "rb") as handle:
            return handle.read(), stills
