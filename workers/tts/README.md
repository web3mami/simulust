# TTS worker (voice notes)

Voice notes are spoken by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
(Apache 2.0) served by [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI),
which exposes an OpenAI-compatible `POST /v1/audio/speech`. The app calls it from
`src/server/tts.ts`; the route is `POST /api/messages/[id]/voice`.

## Why we self-host

Voice notes on Simulust are often erotic. Hosted TTS vendors don't give us a
clear permission for that:

- **Fish Audio**'s terms of use bar sexually explicit content and pornography,
  and obscene use of the service.
- **ElevenLabs**' prohibited-use policy restricts sexual content, says some uses
  need its prior approval, and lets it suspend accounts. Nothing in it says erotic
  audio for an adult companion app is allowed.

A vendor that turns us off takes voice notes down with it, so we run the model
ourselves. Kokoro is small (82M parameters) and its licence allows commercial use.
Like the media worker, it has to run on a host whose terms allow legal adult
content (RunPod, Modal and Together do not; see `docs/build-plan.md`).

## Run it

The image is pinned to a release. Check the
[releases](https://github.com/remsky/Kokoro-FastAPI/releases) before upgrading;
v0.8.1 started capping input length and pause durations.

NVIDIA GPU (CUDA 12.6):

```sh
docker run -d --name kokoro --restart unless-stopped \
  --gpus all -p 127.0.0.1:8880:8880 \
  --log-opt max-size=10m --log-opt max-file=2 \
  ghcr.io/remsky/kokoro-fastapi-gpu:v0.9.0-cu126
```

Use `v0.9.0-cu128` on RTX 50-series/Blackwell cards.

CPU only:

```sh
docker run -d --name kokoro --restart unless-stopped \
  -p 127.0.0.1:8880:8880 \
  --log-opt max-size=10m --log-opt max-file=2 \
  ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0
```

The input text is explicit chat, so keep container logs small and short-lived.

### GPU or CPU?

A voice note is at most 600 characters (about 40 seconds of speech).
Kokoro is small enough that CPU works for development and for launch volumes, but
latency grows with load because requests queue. Start on CPU if the box is
already paid for and move to a GPU when the 95th-percentile time for the curl test
below goes over about 5 seconds under real traffic. The media worker's GPU is
busy with images and video, so don't share it unless you have measured the
headroom.

## Check it

```sh
curl -s http://127.0.0.1:8880/v1/audio/voices | head -c 300

time curl -s http://127.0.0.1:8880/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"kokoro","input":"Hey you. I missed you today.","voice":"af_heart","response_format":"mp3","stream":false}' \
  -o /tmp/kokoro-test.mp3 && ls -l /tmp/kokoro-test.mp3
```

## Connect the app

| Variable | Value |
|---|---|
| `TTS_BASE_URL` | The OpenAI-compatible root, **including `/v1`**, e.g. `https://tts.internal.example.com/v1` |
| `TTS_API_KEY` | Optional. Sent as `Authorization: Bearer <key>` for a proxy in front of Kokoro |
| `TTS_MODEL` | `kokoro` (the default) |

Without `TTS_BASE_URL`, `/api/me` returns `features.voice: false` so the chat
can hide the voice-note button, and the voice route answers 503 "Voice notes
aren't available right now". Clips made earlier are still returned.

Kokoro-FastAPI has **no authentication**. Never expose port 8880 to the
internet. Either reach it over a private network (WireGuard/Tailscale, or the
same VPC as the app), or put a reverse proxy in front of it that checks the
bearer token. With nginx, for example:

```nginx
server {
  listen 443 ssl;
  server_name tts.internal.example.com;
  # ssl_certificate ...

  location /v1/ {
    if ($http_authorization != "Bearer CHANGE_ME_LONG_RANDOM") { return 401; }
    proxy_pass http://127.0.0.1:8880;
    proxy_read_timeout 60s;
  }
}
```

Set `TTS_API_KEY` in the app to the same random value.

## Voices

The creator offers "Voice 1" to "Voice 6". `src/server/tts.ts` maps them to the
best-graded American English Kokoro voices
([grades](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)):

| Label | Kokoro id | Gender | Sound |
|---|---|---|---|
| Voice 1 | `af_heart` | Female | Warm |
| Voice 2 | `af_bella` | Female | Bright |
| Voice 3 | `af_nicole` | Female | Soft, close |
| Voice 4 | `am_michael` | Male | Low, steady |
| Voice 5 | `am_fenrir` | Male | Rough |
| Voice 6 | `am_puck` | Male | Playful |

Rules:

- A woman always gets a female voice and a man a male one. Picking from the
  other set maps to the same position, so "Voice 4" on a woman speaks as `af_heart`.
- Non-binary characters use whichever voice was picked.
- Characters with no pick (the official cast) get a stable voice for their
  gender, chosen from their id, so they don't all sound the same.

Kokoro's male voices are graded lower than the female ones (C+ against A). If
they sound flat in testing, Kokoro can blend voices (`am_michael(2)+am_fenrir(1)`);
change the ids in `VOICES` in `src/server/tts.ts` to a blend string. Chatterbox
(MIT) is the plan for more expressive voices later.

## What the app sends

Before anything reaches Kokoro, the app:

1. checks the user is a verified adult and owns the message;
2. removes `*roleplay actions*`, links, emoji and markdown, and cuts the text to
   600 characters at a sentence end;
3. runs the text through text moderation again (minors, real people,
   prohibited content);
4. charges the voice-note price (refunded if synthesis fails).

The request sets `"stream": false`. Kokoro-FastAPI streams by default, and a
streamed response that fails halfway has already sent its `200`, so the app
would store a cut-off clip. Unstreamed, a failure is an error status and the
user is refunded.

The MP3 is stored privately (R2/S3) and served only to its owner.
