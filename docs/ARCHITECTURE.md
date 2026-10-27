# Simulust architecture

Next.js 16 (App Router) with route handlers as the backend. Postgres via Drizzle.
Every outside service is behind an env var with a local stand-in, so the app runs
end to end on a laptop with no accounts. Production refuses to boot without the
real services: `assertProductionConfig` in `src/server/env.ts` and a genesis-hash
check of both Solana RPCs (`assertSolanaRpcCluster`) run from `src/instrumentation.ts`,
which exits the process on failure, and `next.config.ts` fails a production build
that lacks the `NEXT_PUBLIC_*` values the browser needs.

## Layout

| Path | What |
|---|---|
| `src/server/env.ts` | All configuration and feature flags |
| `src/server/db/schema.ts` | Tables (users, profiles, characters, threads, messages, memories, media, credit_balances, credit_ledger, orders, age_checks, reports, moderation_events, rate_limits). Orders keep every screened address (`payers`). `extra_payments` holds, once per signature, a payment kept for a refund by hand (short, or a repeat to a settled order); refund per signature, after screening its payer. `checked_signatures` remembers transactions that paid nothing, so they're read once. `scan_cursors` records how far the reconcile scan has read each account payments land on (the treasury wallet for SOL, its USDC ATA). |
| `src/server/db/index.ts` | `db()`: Postgres when `DATABASE_URL` is set (migrated by `npm run db:migrate`, or at boot with `AUTO_MIGRATE=1`), otherwise embedded PGlite (with pgvector) that migrates and seeds itself |
| `drizzle/` | SQL migrations (`npm run db:generate` after schema changes) |
| `src/server/auth.ts` | `currentUser`, `requireUser`, `requireVerifiedAdult`, `explicitAllowed`, `requireAdmin`, `isMember` |
| `src/server/http.ts` | `route()` wrapper, `HttpError`, `readJson(request, zodSchema)`, `safeEqual` |
| `src/server/credits.ts` | `spend`, `grant` (idempotent per payment), `refund` (never more than was charged for that id), `chargeForMessage`, `chargeFor`, `lockUser` (per-user transaction lock) |
| `src/server/ratelimit.ts` | `rateLimit(key, max, windowSeconds)` |
| `src/server/llm.ts` | `complete`, `stream`, `embed` against any OpenAI-compatible API, with a dev stand-in |
| `src/server/safety/text.ts` | Deterministic blocklist: `checkText`, `checkImagePrompt` (stricter, for anything that becomes an image; its `minor` flag marks a sexual word next to a child marker), `minorAdjacent` (text worth holding back until the classifier has seen it), `detectCrisis`, `declaresMinorAge`, `asName` (names are screened in title case), `REFUSAL`. Folds zero-width characters and lookalike letters first. Hard-blocks unambiguous minor terms and stated ages; ambiguous words (kid, minor, high school) block only next to sexual or age context and are otherwise left to the classifier. Mirrored by `screen_prompt` in `workers/media/safety.py`. |
| `src/server/safety/moderation.ts` | `moderateText(text, ctx, { failClosed })` (blocklist, then the classifier production requires; the text is sent between BEGIN TEXT/END TEXT markers, only an exact `ALLOW` allows, any form of `BLOCK` blocks, and an unreadable answer is refused), `refusal(verdict)`, `logModeration`. Anything that becomes an image, a character, a memory or a voice note fails closed when the classifier can't answer; a user's chat message falls back to the blocklist. |
| `src/server/storage.ts` | S3/R2 or local disk |
| `src/server/media.ts` | `createMedia`, `storeMedia` (pending rows only), `failMedia` (never un-blocks), `failAbandoned`, `legalHoldUntil`, `getMedia`, `canView`, `toMediaDTO` |
| `src/server/characters.ts` | Character queries and creation. Look and persona fields must come from the creator lists in `src/lib/portrait-prompt.ts`; only the name is free text: one to three words of letters, up to 30 characters, classifier-screened and failing closed. The chat prompt ignores off-list values on older rows. |
| `src/lib/pricing.ts` | USD catalog, per-action credit costs (shared client/server) |
| `src/lib/api-types.ts` | Every DTO the API returns |
| `src/lib/api.ts` | Client: `useApi()` JSON fetch with auth, `useAuthHeaders()` for streams |
| `src/components/auth-gate.tsx` | `useSession()`: `{ ready, session, me, features, suspended, refreshMe, getToken, signOut, openLogin, openSignup }` |

## Rules every route follows

- Wrap handlers in `route()`; throw `HttpError` for expected failures.
- Validate bodies with zod via `readJson`.
- `requireUser` for anything user-specific. `requireVerifiedAdult` before any
  explicit output (photos, voice notes, video, explicit chat mode).
- Every user-supplied string that reaches a model or a prompt goes through
  `moderateText` first. Every generated image or video frame goes through image
  moderation before it is stored as `ready`.
- Charge credits before generating, refund (`refund(userId, amount, mediaId)`)
  if generation fails or is blocked.
- Dynamic route params are Promises in Next 16: `ctx: RouteContext<"/api/x/[id]">`, `const { id } = await ctx.params`.

## API contracts

Auth: `Authorization: Bearer <privy access token>`; the `privy-token` cookie also
works (needed for `<img src>`/`<audio src>`). Dev: `simulust-dev-user` cookie.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/me` | | `MeResponse` |
| PATCH | `/api/me` | `{ displayName?, walletAddress?, settings?: { explicit?, unpromptedMedia? } }` | `{ me }`. A new display name is classifier-screened, failing closed; only a screened name ever reaches a chat prompt. |
| GET | `/api/characters` | | `{ characters: CharacterDTO[] }` (official + own) |
| POST | `/api/characters` | `createCharacterInput` (incl. `imageMediaId` from `/api/portrait`) | `{ character }` |
| GET/DELETE | `/api/characters/[id]` | | `{ character }` / `{ ok }` |
| GET | `/api/threads` | | `{ threads: ThreadDTO[] }` |
| POST | `/api/threads` | `{ characterId }` | `{ thread: ThreadDTO }` (get or create) |
| GET | `/api/threads/[id]` | `?before=<iso>` | `{ thread, messages: MessageDTO[], hasMore }` (oldest first, 50 per page; `before` includes its boundary millisecond, so drop ids you already have). Messages carry `voice` and `video` made from them. |
| POST | `/api/threads/[id]/messages` | `{ content }` | NDJSON stream of `ChatStreamEvent`. A message that mentions self-harm gets a `crisis` event first, whatever else happens (a rate-limited or too-long one gets a 200 stream of `crisis` then `error`), and isn't charged when it would otherwise cost a credit (up to 20 a day). A reply near the line (`minorAdjacent` on the message, the last four history messages or the reply so far) isn't streamed until the classifier has passed all of it. A refused message yields a `notice`. The finished reply is checked again (blocklist and classifier) before it is saved; the `done` message is the authoritative text and may replace what streamed. On a model failure the user's message is deleted and refunded (`error` with code `model_error`). |
| POST | `/api/threads/[id]/photo` | `{ hint? }` | `{ message: MessageDTO, notice: MessageDTO \| null, balance }` (`notice` is the AI-disclosure reminder when one is due). A hint `checkImagePrompt` refuses gets 422 before anything is charged: `blocked_minor` (logged as a minor block, which holds account deletion until reviewed) when it pairs a sexual word with a child marker, otherwise `blocked_image_prompt` (not logged). |
| GET | `/api/memories?characterId=` | | `{ memories: MemoryDTO[] }` |
| DELETE | `/api/memories?characterId=` | | `{ ok, deleted }` (forget everything; also clears the rolling summary) |
| PATCH/DELETE | `/api/memories/[id]` | `{ content?, pinned? }` | `{ memory }` / `{ ok }` |
| POST | `/api/portrait` | creator choices | `{ media: MediaDTO }` |
| GET | `/api/media/[id]` | | the file (owner or admin only) |
| GET | `/api/media/[id]/status` | | `{ media: MediaDTO }` |
| POST | `/api/media/[id]/animate` | `{ prompt? }` | 202 `{ media: MediaDTO, balance }` (video, pending; poll status). Repeat requests for the same photo and motion return the same video. A motion `checkImagePrompt` refuses gets 422 before charging (`blocked_minor` or `blocked_image_prompt`, as for photo hints); 422 `video_blocked` when the worker refuses it. When the worker's tagger flags the source photo, the photo and its other videos are blocked too (files kept) pending review; a hit on the rendered frames alone blocks only the clip. |
| POST | `/api/messages/[id]/voice` | | `{ media: MediaDTO, balance }` |
| GET/PUT | `/api/me/profile` | profile fields | `{ profile }` |
| GET | `/api/me/export` | | JSON download of the user's data |
| DELETE | `/api/me/account` | `{ confirm: "DELETE" }` | `{ ok }`; 409 `deletion_on_hold` while a report about the user's content is open, a legal hold covers media they made, a CSAM report signal stands, or they wrote an image, character or video prompt blocked as minor content in the last 90 days that no admin has reviewed. Chat messages (including self-stated ages) and the model's own output never hold deletion. Expires the user's open checkouts. |
| GET | `/api/credits` | | `{ balance, ledger: LedgerEntryDTO[] }` |
| POST | `/api/orders` | `{ productId, currency: "USDC" \| "SOL" }` | `{ order: OrderDTO }` |
| GET | `/api/orders` | | `{ orders: OrderDTO[] }` |
| GET | `/api/orders/[id]` | | `{ order, watching }` (`watching`: the server would still credit a payment, so keep polling). Re-checks the chain for pending orders, for expired or underpaid ones that closed less than about an hour ago, and for any order holding a payment that waits on sanctions screening (a signature on a pending, expired or underpaid order). `refund_due`: the payment came too late or after the account was deleted; nothing was credited and support refunds it. Payment details (`solanaPayUrl`, `recipient`, `reference`) are empty unless the order is open and its owner isn't deleted, banned or age-locked; a payment to such an account is `refund_due`. |
| GET | `/api/orders/[id]/transaction` | | `{ label, icon }` (Solana Pay) |
| POST | `/api/orders/[id]/transaction` | `{ account }` | `{ transaction: base64, message }` (Solana Pay transaction request; unauthenticated, the order id is the capability). 410 `order_closed` once the order isn't payable, its account was deleted, banned or age-locked, or less than a minute of the price hold is left. |
| POST | `/api/orders/[id]/dev-settle` | | `{ order, watching }` (development only, 404 in production) |
| POST | `/api/age/start` | | `{ url }` (Veriff hosted flow) |
| POST | `/api/age/dev` | `{ outcome: "approved" \| "declined" }` | `{ me }` (development only) |
| POST | `/api/reports` | `{ kind, target, details, email? }` | `{ ok, dueAt }`. Details that mention a child or an age under 18 log a minor signal on the target, so takedowns default to keeping its files. |
| GET/PATCH | `/api/admin/reports` | `{ id, status, resolution }` or `{ id, kind: "csam" }` | open/closed reports (CSAM and intimate-image reports first); resolves one, or reclassifies it as CSAM |
| POST | `/api/admin/reports/takedown` | `{ id, note?, preserve?, kind? }` | `{ ok, resolution, preserved, held, deleted }`. `kind` is the report kind the admin saw (409 `report_changed` if it was reclassified meanwhile); the report is claimed before anything is removed and reopened if the takedown fails. `preserve` defaults to on for CSAM reports and for targets with minor signals (a media item inherits its source photo's and its character's). For an official character, media tied to a minor signal are always held, and all of its media are held when keeping is chosen and the report is CSAM or a CSAM or minor signal on the character itself stands; otherwise the rest are blocked without a hold. Takes the report's target down (media blocked and file deleted, or kept under legal hold for CSAM; character soft-deleted). It cascades: videos made from a photo, and every portrait, photo, video and voice note of a character, go with it under the same hold |
| GET/PATCH | `/api/admin/moderation` | `{ ids }` | unreviewed `age_check_underage` findings, then `self_declared_minor` escalations (one open per user, repeats counted in its details), then blocks and flags, up to 100 of each; PATCH returns `{ ok, reviewed, skipped, note? }` and never marks an age lock reviewed: that closes only through Unban |
| GET/PATCH | `/api/admin/users` | `?q=` / `{ id, banned, reason }` | search (users carry `ageLocked`), ban, unban. Unbanning also closes an open underage finding and resets the user's age status, so they must verify again. |
| GET | `/api/admin/media` | `?status=` | recent generated media with moderation results |
| POST | `/api/webhooks/helius` | Helius raw or enhanced tx (watch the treasury wallet and its USDC token account) | `{ ok }`. Processed synchronously; 503 when a transaction can't be checked yet and 500 on failure, so Helius redelivers. Settlement is idempotent. |
| POST | `/api/webhooks/veriff` | Veriff decision | `{ ok }`. An approval without a readable date of birth is declined. An under-18 date of birth locks the account (every request returns 403 `age_locked`) until an admin unbans it. |
| POST | `/api/webhooks/video` | worker callback | `{ ok }` |
| GET | `/api/cron/reconcile` | `Authorization: Bearer CRON_SECRET` | `{ checked, updated, prunedRateLimits, abandonedMedia, settledVideos }`: settles payments, then fails and refunds media whose request died and nudges stuck videos. Scheduled every minute in `vercel.json`. Payment reconciling has a 40 s budget: held payments are retried first, then each payment account is scanned forward from its cursor (at most 3,000 listed and 300 read per run, shared fairly between accounts), so junk transactions can delay a payment the webhook missed but not hide it. A transaction naming more than three of our orders is applied to none of them (logged for a manual refund). The media sweep runs alongside, so one can't starve the other. |

## Pages

`/` discover · `/create` creator · `/date/[id]` chat · `/chat` chat list ·
`/memories/[characterId]` what a character remembers · `/premium`, `/packs`, `/pricing` ·
`/profile` · `/settings` · `/verify` age verification · `/report` takedown requests ·
`/admin` moderation console · `/terms`, `/privacy`, `/content-policy`, `/safety`, `/dmca`, `/2257`.

## Configuration beyond the core

Image moderation uses three Hive projects (`HIVE_API_KEY`, `HIVE_DEMOGRAPHIC_API_KEY`,
`HIVE_CELEBRITY_API_KEY`, optional `HIVE_API_URL`). SOL pricing uses `PYTH_API_KEY`
and `JUPITER_API_KEY`; sanctions screening uses `CHAINALYSIS_API_KEY` and
`SANCTIONS_BLOCKLIST`. See `.env.example` and `docs/SETUP.md`.

## Workers (self-hosted GPU)

Worker contract: `src/server/images.ts` (POST `/v1/images`), `src/server/video.ts`
(POST `/v1/videos` with a callback to `/api/webhooks/video`, GET `/v1/videos/{id}`),
details in `workers/media/README.md`. `/v1/videos` carries the source's `style`; for
anime clips the worker runs its WD tagger on the sampled frames, and a refused job
ends `failed` with `blocked: <reason>`, which the app records as a blocked video
with a moderation event and a refund. The worker also screens every prompt with
the same rules as the app's blocklist, and refuses anime work when its tagger is off.

`workers/media`: HTTP worker for images (Z-Image-Turbo / Chroma for realistic,
Animagine XL 4.0 for anime, per-character LoRA) and video (Wan 2.2 TI2V-5B
image-to-video). Must run on an adult-tolerant GPU host.
`workers/tts`: Kokoro-FastAPI (OpenAI-compatible `/v1/audio/speech`).
