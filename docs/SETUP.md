# Setting up Simulust

What you need to run Simulust locally, then everything to buy, sign, configure and
decide before real users and real money. Every key goes in `.env.local` locally
and in the host's environment in production. `.env.example` lists each variable
with where to find it.

## 1. Run it locally (no accounts needed)

```bash
npm install
cp .env.example .env.local
npm run dev
```

With nothing configured, every service uses a local stand-in, so the whole product works:

| Area | Local stand-in |
|---|---|
| Database | Embedded Postgres (PGlite, with pgvector) in `.data/pglite`. It migrates and seeds itself. Delete `.data/` to reset. |
| Login | Dev login with any handle. `admin` opens `/admin`. |
| Chat model | Canned replies that echo what you sent |
| Memory | Works; without embeddings it uses recent memories instead of the most relevant |
| Images | Placeholder SVGs (`IMAGE_PROVIDER=mock`) |
| Video | A tiny placeholder MP4 |
| Voice notes | Off until `TTS_BASE_URL` is set |
| Age check | "Approve (dev)" / "Decline (dev)" buttons on `/verify` |
| Payments | "Simulate payment" in the checkout |
| Media files | Stored in `.data/media` |

Checks: `npm run typecheck`, `npm test` (in-memory database), `npm run lint`, `npm run build`.
`npm run build` is a production build: it fails after compiling unless the **[prod]**
`NEXT_PUBLIC_` values are set and agree with `SOLANA_CLUSTER` (they are baked into the
browser bundle). For a local check without them, run `ALLOW_DEV_BUILD=1 npm run build`.
That build can't start in production.

The app refuses to start in production (`next start`) until every **[prod]** item
below is set and consistent. It logs what is wrong and exits, so a bad deploy
crash-loops instead of answering every request with a 500. The checks are
`assertProductionConfig` and `assertSolanaRpcCluster` in `src/server/env.ts`, run
from `src/instrumentation.ts`; the build check is in `next.config.ts`.

## 2. Accounts and services

In rough order of lead time. ⚠ marks places where adult content is the risk:
get the vendor's written OK before you build on them.

### Core

| What | Vendor (suggested) | Env vars | Notes |
|---|---|---|---|
| **[prod] Public URL** | | `APP_URL` | The public `https://` address (not localhost). Video callbacks, Veriff's return link and the Solana Pay icon are built from it. |
| **[prod] Database** | Supabase (Postgres + pgvector) | `DATABASE_URL`, `AUTO_MIGRATE` | Use the transaction-pooler string. Run `npm run db:migrate` on every deploy: it applies `drizzle/` and seeds the official characters. Hosts without a deploy step can set `AUTO_MIGRATE=1` to do the same on first connection, but migrations take no lock, so avoid it when several instances can boot at once. |
| **[prod] Login** | Privy | `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY` (optional), `ADMIN_PRIVY_IDS` | Set the app id for the build as well as at runtime (the browser gets the build's value), and rebuild after changing it. `ADMIN_PRIVY_IDS` lists the Privy user ids (`did:privy:...`, from the dashboard's Users page) that get `/admin`. Only admins can action reports and lift age locks, and every login resets admin rights from this list, so the boot refuses an empty list or an entry that isn't a Privy id. Enable email, Google, X and Solana wallets. Turn on HttpOnly cookies (needs your custom domain) so `<img>`/`<video>` can load private media. ⚠ Privy is owned by Stripe, which bans adult businesses; its own AUP bans only *illegal* adult content. Get written OK. |
| **[prod] Chat model** | DeepInfra or Featherless (OpenRouter pinned to one provider also works) | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_PREMIUM_MODEL`, `LLM_UTILITY_MODEL`, `LLM_EXTRA_BODY` | Open-weight models only: OpenAI, Anthropic and Google don't allow explicit content. ⚠ Their terms are silent on adult fiction, so get written OK. Changing provider is an env change. |
| Memory embeddings | Same provider, `BAAI/bge-m3` | `EMBED_*` | Must return 1024 dimensions. |
| **[prod] Text moderation model** | `gpt-oss-safeguard-20b` on any OpenAI-compatible host | `MODERATION_BASE_URL`, `MODERATION_API_KEY`, `MODERATION_MODEL`, `MODERATION_EXTRA_BODY` | Second layer on top of the built-in blocklist, applying our own policy (`src/server/safety/moderation.ts`). Set `MODERATION_EXTRA_BODY` to the host's low-reasoning field and test it first (below). Not Llama Guard: its fixed taxonomy flags all sexual content, and the app's strict parser can't read its answers. |
| **[prod] Media storage** | Cloudflare R2 (or S3) | `S3_*` | Private bucket. The app serves files through 5-minute signed URLs after checking the owner. R2: set `S3_ENDPOINT` and `S3_REGION=auto`. AWS: leave `S3_ENDPOINT` empty and set the bucket's region (`auto` is refused there). |

`MODERATION_EXTRA_BODY` is merged into every classifier request, and hosts name
the reasoning-effort field differently: `{"reasoning_effort":"low"}` where the
host follows OpenAI's field (vLLM, Groq), `{"reasoning":{"effort":"low"}}` on
OpenRouter. A host that rejects a field it doesn't know answers `400`. Every
check that must not skip the classifier (photos, video motions, characters,
memories) then refuses with "We couldn't run our safety check", and `/admin`
lists each failure as a `classifier_error` moderation event. Before deploying,
send one request with your values; a `200` means the host takes them, and a
`400` usually names the field it rejected:

```bash
curl -sS "$MODERATION_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $MODERATION_API_KEY" -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-oss-safeguard-20b", "max_tokens": 1024,
       "messages": [{"role": "user", "content": "hello"}], "reasoning_effort": "low"}'
```

Replace the model and the last field with your `MODERATION_MODEL` and
`MODERATION_EXTRA_BODY`.

### Images, video, voice (self-hosted GPUs)

⚠ fal, RunPod, Modal and Together all ban explicit content. You need a dedicated
GPU host whose AUP allows legal AI-generated adult content (NovoServe, per the
research), confirmed in writing.

| What | Details | Env vars |
|---|---|---|
| **[prod] Image + video worker** | `workers/media`: FastAPI + diffusers. **Realistic:** Z-Image-Turbo or Chroma1-HD (Apache-2.0). **Anime:** Animagine XL 4.0. **Video:** **Wan 2.2 TI2V-5B** image-to-video (Apache-2.0, 720p, fits one 24 GB GPU). One RTX 4090 / L40S class card, 64 GB RAM, 100 GB disk. First boot downloads about 60 GB of weights. **Not yet tested on a real GPU.** The worker key gets images and clips straight back, without the app's Hive checks: keep it secret and firewall the worker to the app's egress IPs (see the worker README's Hosting section). | `IMAGE_PROVIDER=worker`, `IMAGE_API_URL`, `IMAGE_API_KEY`, `VIDEO_API_URL`, `VIDEO_API_KEY` |
| Separate video worker (recommended) | On one GPU an image waits behind a running video (the app refunds after 60s), so run video on its own card: 32 GB or more if you can, since the worker's age-check tagger keeps 2 to 3 GB beside Wan (an estimate). | `VIDEO_API_URL` |
| Per-character LoRAs | Train one per official character, only on our own generated and moderated images. Reject any whose samples look younger. Steps are in `workers/media/README.md`. | `characters.lora_id` |
| Voice notes | `workers/tts`: Kokoro-FastAPI (CPU is fine to start). It has no auth, so put it on a private network or behind a proxy that checks a bearer token. ⚠ ElevenLabs restricts sexual content and Fish Audio bans it. | `TTS_BASE_URL`, `TTS_API_KEY` |

### Safety and compliance

| What | Vendor | Env vars | Notes |
|---|---|---|---|
| **[prod] Image moderation** | Hive: annual contract (the self-serve API caps at 100 requests a day) | `HIVE_API_KEY`, `HIVE_DEMOGRAPHIC_API_KEY`, `HIVE_CELEBRITY_API_KEY` | Three Hive projects: visual moderation, apparent age, and celebrity recognition. With any missing, every image fails closed. Tune `THRESHOLDS` in `src/server/image-moderation.ts` against real responses. |
| **[prod] Age verification** | Veriff (about $0.80/check, $49/mo minimum) | `VERIFF_API_KEY`, `VERIFF_SHARED_SECRET`, `VERIFF_BASE_URL` | Web integration with document + selfie. Point both webhooks at `{APP_URL}/api/webhooks/veriff`. Decision webhooks **must** include `person.dateOfBirth`: an approval without a readable date of birth is declined (logged as `age_check_no_dob`), so a misconfigured integration declines everyone. We enforce 18+ and store only pass/fail; an under-18 date of birth locks the account for admin review. Also turn on Veriff's own age-validation rule as a second check. Set Veriff's own retention to the minimum. ⚠ Get written OK for an adult platform. |
| CSAM hash matching | Thorn Safer and/or Microsoft PhotoDNA | | Apply now; approval takes time. Not integrated yet. |
| **NCMEC CyberTipline** | NCMEC ESP registration | | Required before launch. Name the staff who file reports. |
| DMCA agent | US Copyright Office directory (~$6) | | Then fill in `src/app/dmca/page.tsx`. |
| Real-name blocklist | | `BLOCKED_NAMES` | Celebrity and public-figure names to refuse. |
| Region blocking | | `BLOCKED_COUNTRIES` | Sanctioned regions by default. Add markets whose age rules you haven't met yet (for example `GB,FR,AU` until Veriff is live there). |
| Trusted edge headers | | `GEO_COUNTRY_HEADER`, `CLIENT_IP_HEADER` | The region block and the report rate limit read only these headers. Defaults suit Vercel (`x-vercel-ip-country`, `x-real-ip`), which overwrites them on every request. Behind Cloudflare use `cf-ipcountry` and `cf-connecting-ip`, and only if the origin refuses traffic that didn't come through Cloudflare; otherwise visitors can set those headers themselves. |

### Payments (Solana)

| What | Env vars | Notes |
|---|---|---|
| **[prod] Treasury wallet** | `TREASURY_ADDRESS` | Use a Squads multisig on mainnet. Create its USDC token account before launch. Sweep regularly. |
| **[prod] Paid RPC** (Helius) | `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL` | Server key private; browser key domain-restricted (the boot check sends `Origin: APP_URL`). At boot each RPC's genesis hash must match `SOLANA_CLUSTER`; an RPC that doesn't answer is only logged. |
| **[prod] Helius webhook** | `HELIUS_WEBHOOK_SECRET` | Raw webhook to `{APP_URL}/api/webhooks/helius`, watching the treasury **and** its USDC token account. The auth header must equal the secret. |
| **[prod] Reconcile cron** | `CRON_SECRET` | `GET /api/cron/reconcile` every minute with `Authorization: Bearer $CRON_SECRET`. It settles anything the webhook missed, expires checkouts, fails and refunds abandoned media, and prunes rate-limit rows. On Vercel, `vercel.json` schedules it and Vercel sends the header; per-minute crons need a paid plan (Hobby allows daily crons only, and refuses the deploy). Self-hosted, or on Hobby with the `crons` entry removed, call it from any scheduler, e.g. a crontab line `* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/reconcile`. |
| **[prod] Cluster** | `SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_CLUSTER` | Exactly `devnet` to test or `mainnet` to launch; any other value (including `mainnet-beta`) stops the boot. Production must set both explicitly, the build refuses mismatched values, and the server refuses a build made for the other cluster. |
| Gas sponsorship | Privy dashboard | Enable Solana sponsorship and fund the fee payer, so USDC payers need no SOL. Set per-user limits. |
| **[prod] Sanctions screening** | `CHAINALYSIS_API_KEY`, `SANCTIONS_BLOCKLIST` | Free API. Confirm it covers Solana. If it's down, payments are held, not credited, and retried. |
| SOL pricing | `PYTH_API_KEY`, `JUPITER_API_KEY` | Pyth needs a key since Aug 2026. Without one, SOL checkout is off on mainnet; USDC still works. |
| Support contact | `NEXT_PUBLIC_SUPPORT_EMAIL` | Shown on pricing and refund pages. |

**Not available:** no card-to-crypto on-ramp. MoonPay, Coinbase, Stripe, Transak
and Ramp all refuse adult merchants. Users fund their wallet from an exchange.

### Hosting

- The app needs streaming responses (up to 120s), `after()` support and a public
  HTTPS `APP_URL`. Turn off response buffering for `/api/threads/*/messages`.
- Vercel refuses request bodies over 4.5 MB. The video worker posts a bigger
  result (over its `CALLBACK_MAX_BYTES`, 4 MB) without the clip, and the app
  fetches the clip from the worker.
- Schedule the reconcile cron (see Payments). `vercel.json` does it on a paid Vercel plan.
- With a bad production config the process exits at boot. Have the platform
  restart it and alert on restarts rather than rely on a port check.
- ⚠ Vercel's AUP bans "obscene, graphic" content. Explicit media is never served
  from the app host (it comes from R2 via signed URLs), but get a written answer or
  self-host `next start` on an adult-tolerant provider.
- Put Cloudflare in front for the country header, real client IPs and DDoS protection.

## 3. Decisions the team owns

These defaults are in the code. Change them as you like.

| Decision | Current default | Where |
|---|---|---|
| Prices | Credit packs $4.99 / $9.99 / $24.99 / $49.99; member $12.99 per 30 days prepaid (unlimited messages, 400 credits) | `src/lib/pricing.ts` |
| Costs per action | Message 1 (after the free allowance), photo 8, voice note 4, video 60, portrait 8 | `src/lib/pricing.ts` |
| Free tier | 50 signup credits, 25 free messages a day | `src/lib/pricing.ts` |
| Member fair-use cap | 600 messages a day | `src/lib/pricing.ts` |
| Purchase cap | $1,000 per account per day (meant to stay inside FinCEN's closed-loop prepaid exclusion; counsel to confirm) | `src/server/solana/orders.ts` |
| Refunds | Store credit by default, or USDC back to the paying wallet within 14 days if unused | `/pricing`, terms |
| Anime lane and "petite"/"small" options | Kept, with adult anchors and negative prompts on every image, apparent-age classifiers on the output, and anime with a small or petite figure always drawn as at least 25 | `src/lib/portrait-prompt.ts` |
| Explicit content | Off by default. Needs a passed age check plus a toggle in Settings (recorded as GDPR consent). | `/settings` |
| AI disclosure | At the first message, then every 3 hours, plus a fixed line on every chat | chat route |
| Payment records | Kept, unlinked, after account deletion (period to be set by counsel) | `orders.user_id` |
| Moderation thresholds | Child 0.2, teen face 0.2, celebrity 0.6, gore 0.5 | `src/server/image-moderation.ts` |
| Voices | Kokoro af_heart, af_bella, af_nicole, am_michael, am_fenrir, am_puck. Listen before launch. | `src/server/tts.ts` |

## 4. Before launch (people, not code)

- Counsel reviews `/terms`, `/privacy`, `/content-policy`, `/safety`, `/dmca`, `/2257`
  and fills the bracketed placeholders: legal entity, addresses, contact emails,
  governing law, retention periods, EU/UK GDPR representatives, processor list.
- A DPIA (sex-life data is GDPR Art. 9 special-category data).
- EU/UK VAT registration for digital services.
- Someone checks `/admin` at least daily. Takedown requests have a 48-hour legal
  deadline, and there's no alerting yet.
- One real devnet purchase with Privy configured (the embedded-wallet + sponsorship path
  hasn't been run against a live Privy app).
- First boot of the GPU worker, with a check that the outputs pass moderation and look right.
