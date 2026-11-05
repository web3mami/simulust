"""Tests for the Venice video backend (venice.py), without Venice, ffmpeg or the
worker's packages: the HTTP client, ffmpeg and the image library are fakes.

Run from anywhere: python3 workers/media/test_venice.py (3.9 or newer).
"""

from __future__ import annotations

import os
import sys
import types
import unittest
from unittest import mock

try:
    import numpy  # noqa: F401
except ImportError:
    sys.modules["numpy"] = types.ModuleType("numpy")
    sys.modules["numpy"].ndarray = object
try:
    from PIL import Image  # noqa: F401
except ImportError:
    _pil, _image = types.ModuleType("PIL"), types.ModuleType("PIL.Image")
    _image.Image = object
    _pil.Image = _image
    sys.modules.update({"PIL": _pil, "PIL.Image": _image})
try:
    import httpx  # noqa: F401
except ImportError:
    _httpx = types.ModuleType("httpx")
    _httpx.TransportError = type("TransportError", (Exception,), {})
    _httpx.Client = object
    _httpx.get = _httpx.delete = None
    sys.modules["httpx"] = _httpx
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.update(VENICE_API_KEY="test-key", FAKE_MODELS="0")

import models  # noqa: E402
import venice  # noqa: E402

CLIP = b"\x00\x00\x00\x18ftypmp42" + b"venice" * 50


class Response:
    def __init__(self, status=200, body=None, content=b"", content_type="application/json"):
        self.status_code = status
        self._body = body
        self.content = content
        self.text = "" if body is None else str(body)
        self.headers = {"content-type": content_type}

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


class Client:
    """Answers each path from a list of scripted responses, recording every call."""

    def __init__(self, **script):
        self.script = {f"/video/{path}": list(answers) for path, answers in script.items()}
        self.calls = []

    def post(self, path, json):
        self.calls.append((path, json))
        answers = self.script.get(path) or [Response(200, {"success": True})]
        return answers.pop(0) if len(answers) > 1 else answers[0]

    def paths(self):
        return [path for path, _ in self.calls]


def queued(**extra):
    return Response(200, {"model": venice.VENICE_VIDEO_MODEL, "queue_id": "q-1", **extra})


PROCESSING = Response(200, {"status": "PROCESSING", "average_execution_time": 60000, "execution_duration": 1000})
VIDEO = Response(200, content=CLIP, content_type="video/mp4")


class Generate(unittest.TestCase):
    def setUp(self):
        patches = [
            mock.patch.object(venice, "encode_image", return_value=b"jpeg-bytes"),
            mock.patch.object(venice, "silent_h264", side_effect=lambda clip, count: (b"h264:" + clip, ["still"] * count)),
            mock.patch.object(venice, "sample_frames", side_effect=lambda stills, count: [b"jpeg"] * count),
            mock.patch.object(venice.time, "sleep"),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def run_clip(self, client, seconds=5):
        return venice.VeniceVideo(client=client).generate(
            image=object(), prompt="slow breathing", negative_prompt="extra limbs", seconds=seconds, seed=7
        )

    def test_queues_the_photo_polls_and_releases(self):
        client = Client(queue=[queued()], retrieve=[PROCESSING, PROCESSING, VIDEO])
        result = self.run_clip(client)
        self.assertEqual(result.mp4, b"h264:" + CLIP)
        self.assertEqual(len(result.frames), 6)
        self.assertEqual(
            client.paths(), ["/video/queue", "/video/retrieve", "/video/retrieve", "/video/retrieve", "/video/complete"]
        )
        body = client.calls[0][1]
        self.assertEqual(body["model"], "wan-2-7-enhanced-image-to-video")
        self.assertEqual(body["duration"], "5s")
        self.assertEqual(body["resolution"], "720p")
        self.assertEqual(body["prompt"], "slow breathing")
        self.assertTrue(body["image_url"].startswith("data:image/jpeg;base64,"))
        # The worker's own minor negatives come first, whatever the app sent.
        self.assertTrue(body["negative_prompt"].startswith(models.MINOR_NEGATIVE))
        self.assertIn("extra limbs", body["negative_prompt"])
        self.assertNotIn("seed", body)
        self.assertEqual(client.calls[1][1], {"model": "wan-2-7-enhanced-image-to-video", "queue_id": "q-1"})
        self.assertEqual(client.calls[-1][1], {"queue_id": "q-1"})

    def test_longer_clips_get_more_stills(self):
        client = Client(queue=[queued()], retrieve=[VIDEO])
        self.assertEqual(len(self.run_clip(client, seconds=10).frames), 12)

    def test_fetches_and_revokes_a_download_url(self):
        client = Client(queue=[queued(download_url="https://dl.example/clip.mp4")], retrieve=[Response(200, {"status": "COMPLETED"})])
        with mock.patch.object(venice.httpx, "get", return_value=Response(200, content=CLIP), create=True) as get, mock.patch.object(
            venice.httpx, "delete", create=True
        ) as delete:
            result = self.run_clip(client)
        self.assertEqual(result.mp4, b"h264:" + CLIP)
        get.assert_called_once_with("https://dl.example/clip.mp4", timeout=120)
        delete.assert_called_once_with("https://dl.example/clip.mp4", timeout=30)
        self.assertEqual(client.paths()[-1], "/video/complete")

    def test_a_content_policy_refusal_fails_the_job_without_a_block(self):
        client = Client(queue=[Response(422, {"error": "content policy"})])
        with self.assertRaises(models.BadRequest) as refused:
            self.run_clip(client)
        self.assertIn("Venice refused the clip: content policy", str(refused.exception))
        # The app files only "blocked: ..." as a moderation block.
        self.assertFalse(str(refused.exception).startswith("blocked"))
        self.assertEqual(client.paths(), ["/video/queue"])

    def test_a_refusal_while_rendering_still_releases_the_clip(self):
        client = Client(queue=[queued()], retrieve=[PROCESSING, Response(422, {"error": {"type": "provider_content_policy"}})])
        with self.assertRaises(models.BadRequest):
            self.run_clip(client)
        self.assertEqual(client.paths()[-1], "/video/complete")

    def test_retries_rate_limits_and_capacity(self):
        client = Client(queue=[Response(429, {"error": "slow down"}), Response(503, {"error": "busy"}), queued()], retrieve=[VIDEO])
        self.run_clip(client)
        self.assertEqual(client.paths()[:3], ["/video/queue"] * 3)

    def test_gives_up_on_a_bad_key_or_balance(self):
        for status in (401, 402, 403):
            client = Client(queue=[Response(status, {"error": "no"})])
            with self.assertRaises(RuntimeError):
                self.run_clip(client)
            self.assertEqual(client.paths(), ["/video/queue"])

    def test_times_out_and_releases(self):
        client = Client(queue=[queued()], retrieve=[PROCESSING])
        clock = iter(range(0, 10_000, 600))
        with mock.patch.object(venice.time, "monotonic", side_effect=lambda: next(clock)):
            with self.assertRaises(RuntimeError) as late:
                self.run_clip(client)
        self.assertIn("didn't finish", str(late.exception))
        self.assertEqual(client.paths()[-1], "/video/complete")

    def test_a_failed_cleanup_never_fails_the_clip(self):
        client = Client(queue=[queued()], retrieve=[VIDEO], complete=[Response(500, {"error": "oops"})])
        self.assertEqual(self.run_clip(client).mp4, b"h264:" + CLIP)

    def test_unknown_status_fails(self):
        client = Client(queue=[queued()], retrieve=[Response(200, {"status": "FAILED"})])
        with self.assertRaises(RuntimeError):
            self.run_clip(client)


class Key(unittest.TestCase):
    def test_sends_the_key(self):
        made = {}

        def client(**kwargs):
            made.update(kwargs)
            return Client()

        with mock.patch.object(venice.httpx, "Client", side_effect=client):
            venice.VeniceVideo().client()
        self.assertEqual(made["headers"], {"Authorization": "Bearer test-key"})
        self.assertEqual(made["base_url"], "https://api.venice.ai/api/v1")

    def test_needs_a_key(self):
        with mock.patch.object(venice, "VENICE_API_KEY", ""), self.assertRaises(SystemExit):
            venice.VeniceVideo()


class SilentH264(unittest.TestCase):
    """The re-encode drops the audio, and the stills cover the whole clip."""

    def run_ffmpeg(self, total, decoded=None):
        commands = []

        def run(command, **_kwargs):
            commands.append(command)
            with open(command[-1], "wb") as handle:
                handle.write(b"h264")
            return types.SimpleNamespace(returncode=0, stderr=b"")

        def read_frames(_path):
            yield {"size": (2, 2)}
            for index in range(total if decoded is None else decoded):
                yield index

        ffmpeg = types.ModuleType("imageio_ffmpeg")
        ffmpeg.get_ffmpeg_exe = lambda: "ffmpeg"
        ffmpeg.count_frames_and_secs = lambda _path: (total, total / 24)
        ffmpeg.read_frames = read_frames
        image = types.SimpleNamespace(frombytes=lambda mode, size, data: data)
        with mock.patch.dict(sys.modules, {"imageio_ffmpeg": ffmpeg}), mock.patch.object(
            venice.subprocess, "run", side_effect=run
        ), mock.patch.object(venice, "Image", image):
            mp4, stills = venice.silent_h264(CLIP, 6)
        return mp4, stills, commands[0]

    def test_drops_audio_and_metadata_as_h264(self):
        mp4, _stills, command = self.run_ffmpeg(121)
        self.assertEqual(mp4, b"h264")
        for flag in ("-an", "libx264", "yuv420p", "+faststart"):
            self.assertIn(flag, command)
        self.assertEqual(command[command.index("-map") + 1], "0:v:0")
        self.assertEqual(command[command.index("-map_metadata") + 1], "-1")

    def test_stills_include_the_first_and_last_frames(self):
        _mp4, stills, _command = self.run_ffmpeg(121)
        self.assertEqual(stills, [0, 24, 48, 72, 96, 120])

    def test_a_short_clip_has_a_still_per_frame(self):
        _mp4, stills, _command = self.run_ffmpeg(3)
        self.assertEqual(stills, [0, 1, 2])

    def test_the_end_is_checked_when_fewer_frames_decode(self):
        _mp4, stills, _command = self.run_ffmpeg(121, decoded=100)
        self.assertEqual(stills, [0, 24, 48, 72, 96, 99])

    def test_a_clip_that_doesnt_decode_fails(self):
        with mock.patch.object(
            venice.subprocess, "run", return_value=types.SimpleNamespace(returncode=1, stderr=b"moov atom not found")
        ), mock.patch.dict(sys.modules, {"imageio_ffmpeg": types.SimpleNamespace(get_ffmpeg_exe=lambda: "ffmpeg")}):
            with self.assertRaises(RuntimeError) as failed:
                venice.silent_h264(CLIP, 6)
        self.assertIn("moov atom", str(failed.exception))


if __name__ == "__main__":
    unittest.main()
