"""Model loading and generation.

One process owns one GPU. Pipelines load lazily (or at start with PRELOAD) and,
with OFFLOAD=1, park in system RAM between uses so the realistic, anime and video
models can share a 24 GB card. Every generation holds GPU_LOCK, so jobs run one
at a time.

Model choices (all licensed for commercial use):
  realistic: Tongyi-MAI/Z-Image-Turbo (Apache-2.0, default) or lodestones/Chroma1-HD (Apache-2.0)
  anime:     cagliostrolab/animagine-xl-4.0 (CreativeML Open RAIL++-M)
  video:     Wan-AI/Wan2.2-TI2V-5B-Diffusers (Apache-2.0), image-to-video
"""

from __future__ import annotations

import base64
import io
import logging
import math
import os
import re
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image

from safety import lora_path

log = logging.getLogger("media-worker.models")

GPU_LOCK = threading.Lock()

REALISTIC_MODEL = os.environ.get("REALISTIC_MODEL", "z-image-turbo")  # or "chroma"
ANIME_REPO = os.environ.get("ANIME_REPO", "cagliostrolab/animagine-xl-4.0")
VIDEO_REPO = os.environ.get("VIDEO_REPO", "Wan-AI/Wan2.2-TI2V-5B-Diffusers")
LORA_DIR = Path(os.environ.get("LORA_DIR", "/loras"))
LORA_SCALE = float(os.environ.get("LORA_SCALE", "0.9"))
OFFLOAD = os.environ.get("OFFLOAD", "1") == "1"
VIDEO_STEPS = int(os.environ.get("VIDEO_STEPS", "40"))
VIDEO_MAX_AREA = int(os.environ.get("VIDEO_MAX_AREA", str(704 * 1280)))  # 720p
VIDEO_FPS = 24
FAKE = os.environ.get("FAKE_MODELS", "0") == "1"

# What we never draw or animate, as the app's MINOR_NEGATIVE words it
# (src/lib/portrait-prompt.ts). The worker adds it to every negative prompt
# itself, so a caller can't leave it out.
MINOR_NEGATIVE = (
    "child, teen, underage, childlike, loli, shota, chibi, aged down, school uniform, "
    "childlike proportions, baby face, young-looking"
)
# Wan's own default negative prompt (translated).
WAN_NEGATIVE = (
    "bright tones, overexposed, static, blurred details, subtitles, worst quality, low quality, "
    "JPEG compression residue, ugly, extra fingers, poorly drawn hands, poorly drawn face, deformed, "
    "disfigured, malformed limbs, fused fingers, still picture, messy background, three legs, "
    "many people in the background, walking backwards"
)


def negative(*parts: str) -> str:
    """MINOR_NEGATIVE, then the given parts. First, so a long caller list can't
    push it past a text encoder's limit (512 tokens for Chroma's and Wan's T5)."""
    return ", ".join(part.strip() for part in (MINOR_NEGATIVE, *parts) if part.strip())


class BadRequest(Exception):
    pass


class Busy(Exception):
    """The GPU didn't free up within the caller's wait."""


def _torch():
    import torch

    return torch


def _place(pipe):
    if OFFLOAD:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to("cuda")
    return pipe


class ImageModels:
    def __init__(self) -> None:
        self._pipes: Dict[str, object] = {}
        self._load_lock = threading.Lock()

    def loaded(self) -> List[str]:
        return sorted(self._pipes)

    def lora_support(self) -> Dict[str, bool]:
        return {style: hasattr(pipe, "load_lora_weights") for style, pipe in sorted(self._pipes.items())}

    def pipe(self, style: str):
        with self._load_lock:
            if style not in self._pipes:
                log.info("Loading %s model", style)
                self._pipes[style] = self._load(style)
                if not hasattr(self._pipes[style], "load_lora_weights"):
                    log.error("%s has no LoRA loader: %s requests with a lora are refused", type(self._pipes[style]).__name__, style)
            return self._pipes[style]

    def _load(self, style: str):
        torch = _torch()
        if style == "anime":
            from diffusers import EulerAncestralDiscreteScheduler, StableDiffusionXLPipeline

            pipe = StableDiffusionXLPipeline.from_pretrained(
                ANIME_REPO, torch_dtype=torch.float16, use_safetensors=True, add_watermarker=False
            )
            pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
            return _place(pipe)
        if REALISTIC_MODEL == "chroma":
            from diffusers import ChromaPipeline

            return _place(ChromaPipeline.from_pretrained("lodestones/Chroma1-HD", torch_dtype=torch.bfloat16))
        from diffusers import ZImagePipeline

        return _place(ZImagePipeline.from_pretrained("Tongyi-MAI/Z-Image-Turbo", torch_dtype=torch.bfloat16))

    def generate(
        self,
        *,
        style: str,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        seed: int,
        lora: Optional[str],
        wait: float,
    ) -> Image.Image:
        """Raises Busy when the GPU isn't free within `wait` seconds."""
        if FAKE:
            return _fake_image(width, height, seed)
        torch = _torch()
        # Loading can take a minute and doesn't need the GPU to itself, so it
        # happens before the wait starts.
        pipe = self.pipe(style)
        lora_file = self._lora_file(pipe, style, lora)
        generator = torch.Generator(device="cpu").manual_seed(seed)

        if style == "anime":
            kwargs = dict(guidance_scale=5.0, num_inference_steps=28)
        elif REALISTIC_MODEL == "chroma":
            kwargs = dict(prompt=prompt, negative_prompt=negative(negative_prompt), guidance_scale=3.0, num_inference_steps=40)
        else:
            # Turbo is distilled without CFG: guidance must be 0 and negative
            # prompts do nothing, so the adult anchors live in the prompt and
            # the output tagger is the worker's own check.
            kwargs = dict(prompt=prompt, guidance_scale=0.0, num_inference_steps=9)

        # Held from the timed acquire to the end: releasing in between would let
        # a queued video take the GPU for minutes while this request waits.
        if not GPU_LOCK.acquire(timeout=wait):
            raise Busy()
        try:
            try:
                if lora_file:
                    pipe.load_lora_weights(str(lora_file.parent), weight_name=lora_file.name, adapter_name=lora)
                    pipe.set_adapters([lora], adapter_weights=[LORA_SCALE])
                if style == "anime":
                    # After the LoRA, which may change the text encoders.
                    kwargs.update(_sdxl_long_prompt(pipe, prompt, negative(negative_prompt)))
                image = pipe(width=width, height=height, generator=generator, **kwargs).images[0]
            finally:
                if lora_file:
                    pipe.unload_lora_weights()
                torch.cuda.empty_cache()
        finally:
            GPU_LOCK.release()
        return image

    def _lora_file(self, pipe, style: str, lora: Optional[str]) -> Optional[Path]:
        if not lora:
            return None
        path = lora_path(LORA_DIR, style, lora)
        if not path.exists():
            raise BadRequest(f"unknown lora {lora}")
        # diffusers adds LoRA loaders pipeline by pipeline (Z-Image got one in
        # 0.36), so name the cause rather than fail inside the pipeline.
        if not hasattr(pipe, "load_lora_weights"):
            raise BadRequest(
                f"the {style} model ({type(pipe).__name__}) has no LoRA loader in this diffusers version; "
                "upgrade diffusers or clear the character's lora_id"
            )
        return path


def compel_literal(text: str) -> str:
    """Escapes compel's prompt syntax so the text is encoded as written.

    Parentheses and quotes would group and weight words (and start .and() or
    .blend() calls), and a + or - at the end of a word would up- or down-weight
    it. compel turns \\( \\) and \\" back into plain characters.
    """
    text = re.sub(r'(?<=[^\s+-])[+-]+(?=[\s(),."=]|$)', "", text)
    return re.sub(r'([()"])', r"\\\1", text)


def _sdxl_long_prompt(pipe, prompt: str, negative_prompt: str) -> dict:
    """Prompt embeddings for SDXL without the 77-token cut.

    SDXL's CLIP encoders read 77 tokens and diffusers drops the rest. The app's
    anime negative prompt is twice that, so the cut would lose the anime minor,
    real-person and nudity terms, and the rating tags at the end of the prompt.
    compel encodes both in 75-token chunks instead.
    """
    from compel import CompelForSDXL

    # With CPU offload the encoders report "cpu" until they run; compel must
    # build its tensors where the encoders will run.
    conditioning = CompelForSDXL(pipe, device=str(pipe._execution_device))(
        compel_literal(prompt),
        negative_prompt=compel_literal(negative_prompt) if negative_prompt.strip() else None,
    )
    return dict(
        prompt_embeds=conditioning.embeds,
        pooled_prompt_embeds=conditioning.pooled_embeds,
        negative_prompt_embeds=conditioning.negative_embeds,
        negative_pooled_prompt_embeds=conditioning.negative_pooled_embeds,
    )


@dataclass
class VideoResult:
    mp4: bytes
    frames: List[bytes]


class VideoModel:
    def __init__(self) -> None:
        self._pipe = None
        self._load_lock = threading.Lock()

    def loaded(self) -> bool:
        return self._pipe is not None

    def pipe(self):
        with self._load_lock:
            if self._pipe is None:
                torch = _torch()
                from diffusers import AutoencoderKLWan, WanImageToVideoPipeline

                log.info("Loading %s", VIDEO_REPO)
                # TI2V-5B has no CLIP image encoder: the image is encoded by the
                # VAE as the first latent frame (expand_timesteps in model_index.json).
                vae = AutoencoderKLWan.from_pretrained(VIDEO_REPO, subfolder="vae", torch_dtype=torch.float32)
                pipe = WanImageToVideoPipeline.from_pretrained(VIDEO_REPO, vae=vae, torch_dtype=torch.bfloat16)
                self._pipe = _place(pipe)
            return self._pipe

    def generate(self, *, image: Image.Image, prompt: str, negative_prompt: str, seconds: int, seed: int) -> VideoResult:
        if FAKE:
            return _fake_video(image, seconds)
        torch = _torch()
        from diffusers.utils import export_to_video

        pipe = self.pipe()
        aspect = image.height / image.width
        mod = pipe.vae_scale_factor_spatial * pipe.transformer.config.patch_size[1]
        height = round(math.sqrt(VIDEO_MAX_AREA * aspect)) // mod * mod
        width = round(math.sqrt(VIDEO_MAX_AREA / aspect)) // mod * mod
        image = image.convert("RGB").resize((width, height), Image.LANCZOS)
        # Wan wants 4k+1 frames; 24 fps * whole seconds + 1 always fits.
        num_frames = VIDEO_FPS * seconds + 1
        generator = torch.Generator(device="cpu").manual_seed(seed)

        with GPU_LOCK:
            try:
                frames = pipe(
                    image=image,
                    prompt=prompt,
                    negative_prompt=negative(negative_prompt, WAN_NEGATIVE),
                    height=height,
                    width=width,
                    num_frames=num_frames,
                    guidance_scale=5.0,
                    num_inference_steps=VIDEO_STEPS,
                    generator=generator,
                ).frames[0]
            finally:
                torch.cuda.empty_cache()

        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "clip.mp4")
            export_to_video(frames, path, fps=VIDEO_FPS)
            with open(path, "rb") as handle:
                mp4 = handle.read()
        return VideoResult(mp4=mp4, frames=sample_frames([_to_pil(frame) for frame in frames]))


def _to_pil(frame) -> Image.Image:
    if isinstance(frame, Image.Image):
        return frame
    import numpy as np

    array = np.asarray(frame)
    if array.dtype != np.uint8:
        array = (np.clip(array, 0, 1) * 255).round().astype(np.uint8)
    return Image.fromarray(array)


def sample_frames(frames: List[Image.Image], count: int = 6, max_side: int = 768) -> List[bytes]:
    """Evenly spaced JPEG stills (first and last included) for the app to moderate."""
    if not frames:
        return []
    count = min(count, len(frames))
    picks = sorted({round(i * (len(frames) - 1) / max(1, count - 1)) for i in range(count)})
    out: List[bytes] = []
    for index in picks:
        still = frames[index].convert("RGB")
        still.thumbnail((max_side, max_side))
        buffer = io.BytesIO()
        still.save(buffer, format="JPEG", quality=88)
        out.append(buffer.getvalue())
    return out


def encode_image(image: Image.Image, fmt: str) -> bytes:
    buffer = io.BytesIO()
    if fmt == "png":
        image.save(buffer, format="PNG")
    elif fmt == "webp":
        image.save(buffer, format="WEBP", quality=92)
    else:
        image.convert("RGB").save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def decode_image(data: str) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(base64.b64decode(data, validate=True)))
        image.load()
    except Exception as error:  # noqa: BLE001 - any decode failure is the client's
        raise BadRequest(f"image is not a valid base64 image: {error}") from error
    if image.width * image.height > 4096 * 4096:
        raise BadRequest("image is too large")
    return image.convert("RGB")


# FAKE_MODELS=1: CPU-only stand-ins that honour the HTTP contract, for checking
# the app against the worker without a GPU.
def _fake_image(width: int, height: int, seed: int) -> Image.Image:
    import numpy as np

    rng = np.random.default_rng(seed)
    base = rng.integers(40, 200, size=3)
    y = np.linspace(0, 1, height)[:, None, None]
    array = (base[None, None, :] * (0.4 + 0.6 * y)).astype(np.uint8).repeat(width, axis=1)
    return Image.fromarray(array)


def _fake_video(image: Image.Image, seconds: int) -> VideoResult:
    import imageio.v3 as iio
    import numpy as np

    still = image.convert("RGB").resize((256, 320))
    frames = []
    for i in range(seconds * 8):
        shift = int(8 * math.sin(i / 4))
        frames.append(np.roll(np.asarray(still), shift, axis=1))
    mp4 = iio.imwrite("<bytes>", np.stack(frames), extension=".mp4", fps=8)
    return VideoResult(mp4=mp4, frames=sample_frames([Image.fromarray(frame) for frame in frames]))
