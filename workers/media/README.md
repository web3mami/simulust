# Simulust media worker

A small HTTP server that runs our image and video models on one GPU. The app
calls it for creator portraits, chat photos and image-to-video clips.

> **Untested on a GPU.** This is a reference implementation written against the
> current diffusers APIs and model cards. The Python files compile and the
> app-side contract is covered by tests in the app (with a fake worker), but no
> model here has been run end to end yet. Expect to fix versions and settings
> on first boot. Start with `FAKE_MODELS=1` to check the HTTP contract on any
> machine, then move to a GPU.

## Models

| Use | Model | License | Notes |
|---|---|---|---|
| Realistic images (default) | [`Tongyi-MAI/Z-Image-Turbo`](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) | Apache-2.0 | 6B, 9 steps, fits 16 GB. No negative prompt (CFG is distilled out), so the adult anchors live in the prompt. |
| Realistic images (alternative) | [`lodestones/Chroma1-HD`](https://huggingface.co/lodestones/Chroma1-HD) | Apache-2.0 | 8.9B, 40 steps, supports negative prompts. `REALISTIC_MODEL=chroma`. |
| Anime images | [`cagliostrolab/animagine-xl-4.0`](https://huggingface.co/cagliostrolab/animagine-xl-4.0) | CreativeML Open RAIL++-M | SDXL. Its use restrictions forbid illegal and exploitative content, which our policy already does. Prompts go through [compel](https://github.com/damian0815/compel), because SDXL's text encoders read only 77 tokens and the app's anime negative prompt is about twice that. |
| Video | [`Wan-AI/Wan2.2-TI2V-5B-Diffusers`](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers) | Apache-2.0 | Image-to-video through `WanImageToVideoPipeline`, 720p, 24 fps, 5 s clips. |
| Age and people check | [`SmilingWolf/wd-eva02-large-tagger-v3`](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3) | Apache-2.0 | ONNX tagger trained on drawn images. Refuses every image, video source image and clip whose sampled frames it tags as childlike or as showing more than one person, whatever style the request declares, before anything leaves the worker. |

Avoid NoobAI and FLUX.1/FLUX.2 [dev] (non-commercial licences) and Wan 2.2 A14B
unless you have 80 GB cards.

## API

Every `/v1` route needs `Authorization: Bearer $API_KEY`. The app sends the same
key as `IMAGE_API_KEY` / `VIDEO_API_KEY`, and the worker uses it when it calls
the app back.

### `POST /v1/images`

```json
{ "prompt": "...", "negative_prompt": "...", "width": 896, "height": 1152,
  "seed": 1234, "lora": "mira_v1", "style": "realistic" }
```

No field turns the age or [people check](#safety-on-the-worker) off, since a
leaked key would send it; unknown fields (such as an old `"one_person": false`)
are ignored.

- `200`: the image bytes (`image/jpeg` by default, see `OUTPUT_FORMAT`) with an `X-Seed` header.
- `422 {"error": "blocked", "reason": "..."}`: the worker's own safety checks refused the prompt, the negative prompt or the result (see [Safety on the worker](#safety-on-the-worker)). The app treats this as a moderation block and refunds.
- `400` bad input (unknown LoRA, or a LoRA for a model with no LoRA loader), `401` bad key, `500` generation failed.
- `503` busy (GPU held by a video for more than `IMAGE_WAIT_SECONDS`), safety check unavailable, or `safety check is off` (the age check is off, so the worker refuses all work).
- FastAPI's own validation errors are also `422`, as `{"detail": [...]}`. Only `{"error": "blocked"}` is a safety refusal.

### `POST /v1/videos`

```json
{ "job_id": "<media uuid>", "image": "<base64>", "image_mime_type": "image/png",
  "prompt": "...", "negative_prompt": "...", "seconds": 5, "style": "anime",
  "callback_url": "https://app.example/api/webhooks/video" }
```

`style` (optional) is the source image's declared style, which the worker only
logs: the age and people checks run on every source image and clip whatever it
says, and, as for images, nothing in the request turns them off.

Returns `202 {"job_id", "status": "queued"}`. Submitting the same `job_id`
again returns the existing job instead of rendering twice. `422 {"error":
"blocked", "reason"}` means the worker refused the motion prompt or the
negative prompt; `503` means the queue is full or the age check is off.

### `GET /v1/videos/{job_id}`

```json
{ "job_id": "...", "status": "queued | running | succeeded | failed",
  "video_base64": "...", "mime_type": "video/mp4",
  "frames": ["<base64 jpeg>", "..."], "error": "..." }
```

`frames` are six evenly spaced stills (first and last included). The app runs
image moderation on every one before it stores the clip. The worker first runs
the tagger on the source image (before rendering) and on the same stills; if it
flags any, the job ends `failed` with `error: "blocked: apparent minor (source|frames): <tags>"`
(childlike) or `"blocked: people (source|frames):<tags>"` (a second person) and
no video, and the app blocks the clip, logs a moderation event and refunds.
If the tagger can't run, the job fails without a video. Finished jobs are kept
for `RESULT_TTL_SECONDS` (one hour).

When a job finishes, the worker POSTs the same body to `callback_url` with the
bearer key, retrying for about eight minutes on errors and on `409`. A body over
`CALLBACK_MAX_BYTES` goes as just `{"job_id", "status"}`, without
`video_base64` and `frames`, and so does a retry after a `413`; the app then
fetches the result from this route. Vercel refuses request bodies over 4.5 MB,
and a 5 s 720p clip with its frames in base64 can come close. If every attempt
fails, the app polls this route once a job has been pending for two minutes.

### `GET /health`

No auth. Reports which models are loaded, the queue length, GPU memory,
`anime_tagger` (whether the age check is on), `lora` (for each loaded image
model, whether it can load LoRAs) and `video_lora` (the video LoRA's source and
scale, or `null`).

## Running it

```bash
docker build -t simulust-media workers/media
docker run --gpus all -p 8000:8000 \
  -e API_KEY=change-me \
  -e CALLBACK_PREFIX=https://app.example/api/webhooks/video \
  -e PRELOAD=realistic,anime \
  -v /srv/hf:/models -v /srv/loras:/loras \
  simulust-media
```

Then in the app's environment:

```bash
IMAGE_PROVIDER=worker
IMAGE_API_URL=https://media-worker.internal:8000
IMAGE_API_KEY=change-me
# Optional: a second worker just for video (recommended, see below)
VIDEO_API_URL=https://video-worker.internal:8000
VIDEO_API_KEY=change-me
APP_URL=https://app.example   # used to build the callback URL
```

Contract check without a GPU (CPU only, no model downloads):

```bash
pip install fastapi "uvicorn[standard]" httpx pydantic pillow numpy imageio imageio-ffmpeg
cd workers/media && FAKE_MODELS=1 ANIME_TAGGER=0 API_KEY=dev uvicorn app:app --port 8000
```

The tagger's age and people decisions have tests that need no model and no
packages, on Python 3.9 or newer: `python3 workers/media/test_safety.py`. The
app's `npm test` runs them too (`src/server/worker-safety.test.ts`), so CI does.

### Settings

| Variable | Default | What |
|---|---|---|
| `API_KEY` | (required) | Shared secret with the app. `ALLOW_NO_AUTH=1` skips it for local tests only. |
| `CALLBACK_PREFIX` | empty | Only callback URLs starting with this are accepted. Set it to the app's webhook URL. |
| `CALLBACK_MAX_BYTES` | `4000000` | Larger video callbacks leave out the clip and frames, and the app fetches them. Under Vercel's 4.5 MB request limit; lower it for a proxy with a smaller one (nginx defaults to 1 MB), although a `413` also makes the worker resend the short form. |
| `ENABLE_IMAGES`, `ENABLE_VIDEO` | `1` | Turn one side off to split images and video across GPUs. |
| `REALISTIC_MODEL` | `z-image-turbo` | Or `chroma`. |
| `OFFLOAD` | `1` | `enable_model_cpu_offload()`: models wait in system RAM, so several fit one card. Plan for about 64 GB of RAM. Set `0` on 80 GB cards for speed. |
| `PRELOAD` | empty | Comma list of `realistic,anime,video` to load at start instead of on first request. |
| `LORA_DIR`, `LORA_SCALE` | `/loras`, `0.9` | LoRAs live at `$LORA_DIR/<style>/<lora_id>.safetensors`. |
| `VIDEO_LORA`, `VIDEO_LORA_SCALE` | empty, `1.0` | An optional LoRA for the video model, on for every clip: a local `.safetensors` path, or a Hugging Face file as `owner/repo@revision/file.safetensors`. See [Explicit motion](#explicit-motion). |
| `VIDEO_STEPS` | `40` | Wan's card uses 50. Fewer is faster and a little softer. |
| `VIDEO_MAX_AREA` | `901120` | 704 x 1280 pixels (720p). Lower it for speed. |
| `OUTPUT_FORMAT` | `jpeg` | `jpeg`, `png` or `webp`. |
| `ANIME_TAGGER`, `ANIME_TAGGER_REPO`, `ANIME_TAGGER_THRESHOLD` | `1`, wd-eva02-large-v3, `0.3` | The age check on every image, video source and clip (named for its anime training). It loads at start and fails closed: if it can't run, images return 503 and clips fail. With real models, `ANIME_TAGGER=0` (which also turns off the people check) makes the worker refuse every image and video (503); only the `FAKE_MODELS=1` contract check runs without it. |
| `PEOPLE_TAGGER_THRESHOLD` | `0.35` | The score at which a tag for a second person refuses an image or a video source image, on the same tagger; a clip's frames need it in two frames, or in one frame halfway from it to 1 (0.675 at the default) or on two different readings (see [Safety on the worker](#safety-on-the-worker)). Both thresholds must be between 0 and 1; anything else stops the worker at start. |
| `IMAGE_WAIT_SECONDS` | `60` | How long an image request waits for the GPU before answering 503. It holds the GPU from then until its image is done; a cold model load happens before the wait starts. |
| `MAX_QUEUE`, `RESULT_TTL_SECONDS` | `20`, `3600` | Video queue length and how long results are kept. |
| `HF_HOME`, `HF_TOKEN` | `/models` | Model cache; a token only if a repo becomes gated. |

## GPU sizing

- **One 24 GB card** (RTX 4090 or similar; a 48 GB L40S is more comfortable) runs everything with `OFFLOAD=1` and, as a planning figure, 64 GB of system RAM, although the tagger may leave Wan too little (see below). Images take seconds. Wan 2.2 TI2V-5B renders a 5 s 720p clip in under 9 minutes on one RTX 4090 according to its model card, and it needs at least 24 GB with offloading.
- While a video renders, the GPU is busy: image requests wait up to `IMAGE_WAIT_SECONDS`, then the app refunds. **In production run two workers**: one with `ENABLE_VIDEO=0` behind `IMAGE_API_URL`, one with `ENABLE_IMAGES=0` behind `VIDEO_API_URL`.
- **Wan 2.2 A14B** (the larger image-to-video model) needs about 80 GB (A100/H100 80 GB). Not worth it for 5 s companion clips.
- **The tagger's GPU memory.** onnxruntime runs the tagger on the GPU and keeps the memory it takes for the life of the process: about 2 to 3 GB by our estimate (1.2 GB of weights plus onnxruntime's memory pool), not measured. Every worker loads it at start, the video worker included, and Wan needs about 24 GB with offloading, so a 24 GB video worker may run out of memory mid-clip. Give the video worker a 32 GB or larger card (RTX 5090, L40S), or set `ANIME_TAGGER_DEVICE=cpu` there (slower tagging, a few seconds per clip's stills), or render a few clips on the 24 GB one before launch.
- Disk: about 60 GB of weights. Keep `/models` on a persistent volume or every restart downloads them again.

Speed figures above are from the model cards, not our measurements. Measure on
the real host before setting prices; `COSTS.video` in `src/lib/pricing.ts`
assumes a clip costs well under the 60 credits it charges.

## Hosting

Explicit content rules out most GPU clouds. From our vendor research
(`docs/build-plan.md`, section 3):

- **fal**: AUP bans sexually explicit content.
- **RunPod, Modal, Together**: ban pornographic content.
- **Replicate**: ambiguous ("obscene" content banned).
- **NovoServe** bare metal explicitly allows legal adult content.

Pick an adult-tolerant dedicated GPU host, and **get the acceptable use policy
confirmation in writing** before launch, naming AI-generated adult imagery of
fictional adults. Keep the worker on a private network or behind a firewall that
only admits the app's egress IPs; the bearer key is the second line, not the
first. Vercel functions call out from shared addresses by default: use Vercel's
fixed-IP option if your plan has one, put a proxy with a fixed address in
between, or self-host the app.

## Per-character LoRAs

A LoRA gives a character the same face in every photo.

1. Generate 20 to 40 images of the character with the base model and their
   creator prompt, varying pose, outfit, lighting and framing. Never train on
   photos of real people: that is a real-person likeness, which we prohibit.
2. Run every training image through the same moderation the app uses (Hive
   visual, demographic and celebrity). Drop anything borderline.
3. Caption each image with a unique trigger token (for example `mira_sl`) plus a
   short description. Keep the adult wording ("adult woman", "mature face").
4. Train rank 16 to 32 for about 1,500 to 3,000 steps:
   [kohya-ss/sd-scripts](https://github.com/kohya-ss/sd-scripts) or diffusers'
   `train_dreambooth_lora_sdxl.py` for the anime model;
   [ostris/ai-toolkit](https://github.com/ostris/ai-toolkit) for Chroma or
   Z-Image (check it supports the model version you run). Z-Image LoRAs need
   diffusers 0.36 or later, which has its LoRA loader; `GET /health` shows
   `"lora": {"realistic": true}` once the model has loaded. Without a loader,
   every photo of a character with a `lora_id` fails with a `400` naming the
   cause, and the app refunds it.
5. Before shipping, generate 50 samples with the LoRA and run them through
   moderation. A LoRA that pulls faces younger is rejected, not tuned.
6. Copy it to `$LORA_DIR/<style>/<lora_id>.safetensors` on every worker and set
   `characters.lora_id` for that character.

## Explicit motion

The app's Video Studio (`/studio`) makes a keyframe of one character in a scene
the user picks, then animates it here. The site is uncensored for confirmed
adults, so that scene can be topless or nude, and the motion can be a slow
undress.

Base Wan 2.2 TI2V-5B renders nudity poorly: bodies smear, clothing reappears
between frames, anatomy drifts. The fix is a LoRA trained for adult motion on
top of it, set with `VIDEO_LORA`:

```bash
# A file in a Hugging Face repo, pinned to the commit you vetted:
VIDEO_LORA=some-org/wan22-5b-motion@3f2c1e9/motion_v1.safetensors
# or a local file on the worker's volume:
VIDEO_LORA=/loras/video/motion_v1.safetensors
VIDEO_LORA_SCALE=0.8
```

It loads once with the video model and stays on for every clip, chat
animations included. That's fine always-on: only confirmed adults can make
clips at all (the app's animate route requires a signed-in account with an age
confirmation and no explicit hold), and Hive still screens every sampled frame
before a clip is stored. Only `.safetensors` are accepted (pickled weights can
run code), and a malformed value stops the worker at start rather than failing
clips later. `GET /health` shows what's loaded under `video_lora`.

**Vet a LoRA before it goes anywhere near production.** A video LoRA changes
what every clip looks like, so treat it like a model release:

1. **It's for Wan 2.2 TI2V-5B.** LoRAs for the 14B models or for Wan 2.1 don't
   load, or load and do nothing useful.
2. **License.** Commercial use allowed, in writing on the model card. Many
   community LoRAs are "non-commercial" or say nothing; both are a no.
3. **Training data.** Adults only, no real people. Skip anything trained on
   scraped clips of identifiable performers, anything named after a person, and
   anything whose card or samples lean young ("petite", "teen", school themes,
   childlike proportions). A LoRA that pulls faces or bodies younger is
   rejected, not tuned down.
4. **Pin it.** Download it once, or pin the Hugging Face revision you checked,
   so the weights can't change under you. Keep a checksum with the release.
5. **Test it on the real pipeline.** Render 50 or more clips from a spread of
   realistic and anime keyframes (petite and curvy, men and women) and run every
   clip's frames through the tagger and the app's Hive moderation. Any minor
   flag, any face that reads young, any second person appearing (the tagger's
   people check refuses most, but not all): reject it.
   Then tune `VIDEO_LORA_SCALE`; 0.6 to 1.0 is the usual range, lower keeps more
   of the base model's identity and motion.
6. **Re-run the samples** whenever the LoRA, the scale or the Wan version
   changes.

Nothing about the safety checks changes with a LoRA loaded: the worker's prompt
screen still refuses minor, school and real-person terms and adult words in the
negative prompt, the tagger still checks the source image before rendering and
the sampled frames after, and the app still runs Hive on every frame (nudity is
only allowed through for a user who may see it: a confirmed adult with no
explicit hold when the clip finishes) before anything is stored. A refused clip
is refunded.

## Safety on the worker

The app is the main safety layer: it screens prompts, adds adult anchors and
negative prompts, and moderates every image and video frame with Hive before
anything is stored. The worker has checks of its own so a leaked key or an app
bug can't produce prohibited content. None of them trusts the request's
`style`, which the caller sets:

- Positive prompts with minor-related terms, stated ages under 18 or real-person
  requests are refused with `422`.
- Negative prompts that name an adult (`adult`, `mature`, `woman`, `man`, an
  adult age) are refused with `422 term:<word> (negative prompt)`: negating them
  pushes the models that use a negative prompt (Animagine, Chroma, Wan) younger.
  The worker also puts its own minor terms first in every negative prompt.
  Z-Image Turbo ignores negative prompts.
- Every generated image, every video source image (before rendering) and every
  clip's six sampled frames go through the WD tagger. Tags such as `loli`,
  `shota`, `child`, `aged_down` or school uniforms above the threshold are
  refused: `422 apparent minor: <tags>` for an image, a job `failed` with
  `blocked: apparent minor (source): <tags>` or `blocked: apparent minor (frames): <tags>`
  for a video. The app blocks the user's source photo only for a `source` hit; a
  `frames` hit may just be the clip drifting younger, so only the clip is refused.
- The same images and frames go through a people check on the same tagger, in
  both styles: every picture and clip shows one character, alone. It looks for
  a tag for more than one person (`multiple_girls`, `multiple_boys`,
  `multiple_others`, `2girls` to `6+girls`, `2boys` to `6+boys`, `hetero`,
  `yuri`, `yaoi`, `group_sex`, `threesome`, `ffm_threesome`, `mmf_threesome`,
  `gangbang`, `orgy`), for a partner's body (`faceless_male`,
  `disembodied_penis`, `pov_hands`, and every `hand_on_another's_*`,
  `hands_on_another's_*`, `grabbing_another's_*` and `holding_another's_*` tag
  the tagger knows; `hand_on_own_*` and the like are the character's own hands
  and aren't watched), or two one-person tags together in one image
  (`1girl` and `1boy`, or either with `1other`, a person the tagger calls
  neither), at or above `PEOPLE_TAGGER_THRESHOLD` (0.35). One image (a picture,
  or a video's source before rendering) is refused on any of them. A clip's six
  frames are refused when two frames have one, or one frame has one halfway
  from the threshold to 1 (0.675 at the default), or one frame has two
  different readings (`hetero` and `1girl+1boy`, `2girls` and `yuri`): a
  partner stays in the clip for more than one still or shows up in more than
  one way, while one blurred still read as two people shouldn't cost a solo
  clip. Tags one misread person fires together are one reading: a head count
  and the tags it implies (`2girls` and `multiple_girls`, `threesome` and
  `group_sex`), a man's body (`faceless_male` and `disembodied_penis`), a hand
  (`pov_hands` and every `*_another's_*` family), and the three pairs. The age
  check isn't relaxed that way: any one frame counts.
  Refusals read `422 people:<tag>:<score>, ...` for an image (a pair as
  `1girl+1boy:<lower score>`), and a job `failed` with
  `blocked: people (source):...` or `blocked: people (frames):...` for a video.
  A childlike tag takes precedence when both fire. Not `implied_sex`: it marks a
  partner kept out of the picture and fires on solo scenes the app allows (toys,
  touching herself), while a partner in the frame shows up as one of the above.
  The app files these refusals as `one_person` (the one-person rule, never
  minor content) and refunds; a `people` hit on a video source never blocks the
  user's photo.
- The people check complements the app's text checks, which come first:
  `bringsOthers` and `studioBringsOthers` (`src/server/studio.ts`) refuse a chat
  photo hint, a studio scene or a clip motion that brings someone else in, and
  `OTHER_PEOPLE_NEGATIVE` goes in every negative prompt. Those stop a second
  person from being asked for; this catches one the model draws anyway. Nothing
  in a request turns it off, as for the age check.
- Tags the tagger doesn't know are ignored. At start it logs the minor tags and
  people checks it watches, and the listed tags and families it doesn't know,
  and stops if it knows none of the minor or none of the people tags.
- With real models the worker refuses all work while the tagger is off.

What the worker can't do: the tagger was trained on drawn images. On realistic
output it still flags a drawn-looking minor (a request can declare an anime
picture realistic) and minor-coded tags such as school uniforms, but it doesn't
judge the apparent age of a real-looking face. That check is Hive's, and it runs in
the app. Anyone holding the worker key calls the worker directly and gets
images and clips back without Hive, so keep `API_KEY` as secret as the payment
keys, rotate it on any suspicion, and firewall the worker to the app (see
[Hosting](#hosting)). At first boot, also run 50 or more adult realistic samples
through the tagger: a false positive costs the user a refund, and
`ANIME_TAGGER_THRESHOLD` applies to every style.

Counting people doesn't need a drawn face, so the people check runs on both
styles; we expect it to read realistic images well enough to count people, but
haven't measured it, so it is a backstop to the app's text checks, not a
replacement. Refusing a solo picture a user paid for is a real bug, so measure
its false positives in the same first-boot run, in both styles, with the solo
pictures that look most like two people, and note each refusal's tag and score:

- men alone in close-ups, head cropped or nude (`faceless_male`, and
  `disembodied_penis` on his own body);
- the non-binary character and other androgynous ones (`1other` with `1girl`
  or `1boy`, or `1girl` and `1boy` at once);
- long-haired men (`1girl` and `1boy` at once);
- the studio's dressing-mirror and other mirror scenes (a reflection read as
  `2girls` or `hand_on_another's_*`);
- solo toy scenes, a dildo or a vibrator, in both styles, as pictures and as
  clips (`disembodied_penis` on the toy, and `hetero` with it; one clip frame
  with both is two readings, which refuses the clip);
- moving clips, especially the undress and touching motions: how often one
  frame trips on one reading (the clip rule lets it pass), how often one frame
  has two readings and how often two frames trip (both refuse).

If solo pictures trip on one tag (`disembodied_penis` or `hetero` on a toy, say),
give that tag its own, higher threshold (a small change to `_people_in` in
`safety.py`, with a test) rather than raising `PEOPLE_TAGGER_THRESHOLD` for
every tag or dropping the tag from the list.

The `*_another's_*` families are watched by prefix, so the tagger's snapshot
decides which members are in. In the same first boot, list every tag it has
with `another's` in it:

```bash
# On the host: /srv/hf is the volume mounted at /models.
find /srv/hf -name selected_tags.csv -exec grep -h "another's" {} + | cut -d, -f2 | sort -u
```

Members of the watched families (`hand_on_another's_`, `hands_on_another's_`,
`grabbing_another's_`, `holding_another's_`) appear in the startup log's
"People check watching" line. Review the rest one by one: a tag that can only
mean a second person in the frame goes into `_PEOPLE_BLOCK` or
`_PEOPLE_FAMILIES` in `safety.py`, with a test; one that also fires on a
character alone stays out. Any `*another's_*` tag counts as one reading, "a
hand", in a clip frame, so one blurred frame with her own hands misread under
several of them still passes. Do it again whenever `ANIME_TAGGER_REPO` changes.

Nothing is stored on the worker. Finished video jobs stay in memory for an hour
and are then dropped.
