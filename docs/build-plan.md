# Simulust: what we need to build a better candy.ai on crypto

*Prepared 2026-10-26. Sources are listed at the end. Unconfirmed figures are labelled.*

**Short answer:** We can build a better candy.ai. The parts that cost the most time and money are compliance, finding vendors that allow adult content, and safety. The AI features are the easier part. Today the Simulust repo is a good-looking frontend with no backend, no language model, no payments, no real age check and no moderation. Crypto gives us a real but narrow edge. It does not remove any legal obligation.

---

## 1. What candy.ai is and where it is weak

Candy.ai is run by EverAI Limited (Malta). It is a web-only PWA with no native app. Its free tier is tiny and leads into a subscription plus a token economy:

- **Premium:** reported at about $13.99/mo with a $9.99 first month. Quarterly is about $8.99/mo. Annual is somewhere between $3.99 and $6.30/mo, depending on the promotion. These are third-party figures; the homepage shows no amounts. Premium includes unlimited text and 100 tokens/mo.
- **Tokens:** about $0.10 each. Testers report 2–4 tokens per image, about 3 per call minute and about 12 per image-to-video clip. Candy does not publish most of these prices.
- **Free tier:** reported as about 5 messages total. Sources disagree and this is unconfirmed.
- **Traction:** figures range from about $25M ARR to a "nine-figure" claim. None comes from a primary source, so treat them as promotional.

| Weakness | Evidence |
|---|---|
| Memory resets after 48–72h, and memory slots are sold as an upsell | Reviews; Candy's own Trustpilot replies pointed users to memory slots |
| Repetitive replies in long chats | Reviews |
| Opaque token pricing; real spend of $25–100/mo | Most per-action prices are unpublished |
| Harsh billing terms | Confirmed in the ToS: refunds within 24h only, **card purchases only** (crypto payers get no refund at all), and tokens expire after cancellation |
| Trust gap | Trustpilot removed Candy's profile for breaching its guidelines (confirmed) |
| Product gaps | Live video is mobile-only and limited to selected characters; voice calls are still in beta; the new roleplay mode is criticised as railroading; characters send unsolicited media by default; no published encryption or retention policy |
| Crypto | The homepage advertises BTC, ETH, USDC and LTC. The ToS lists only card, Pay by Bank and regional methods. We found no third-party confirmation that crypto checkout works, so treat it as advertised but unverified. |

**Where competitors already beat Candy:**
- Nomi and Kindroid on memory, group chats and proactive messages.
- SpicyChat, CrushOn and Janitor on cheap text chat and large community character libraries.
- OurDream on media volume: $19.99/mo includes 1,000 coins (confirmed).

**Market signals:**
- xAI is retiring its avatar Companions, per a 2026-07-24 statement (medium-low confidence).
- Character.AI banned under-18s from open-ended chat.
- Crypto-native companion tokens are failing. MyShell's SHELL token is near all-time lows at about $5–6M market cap.

## 2. What "better" should mean for Simulust

1. **Memory as the headline feature, never an upsell.** Persistent long-term memory, plus a "what she remembers" page where users can see, edit and delete memories. This answers Candy's top complaint and the "invisible memory" complaints about Replika. Note that the Ember pack's "3-day memory" in `src/lib/packs.ts` does the opposite and should go.
2. **Published per-action prices and fair terms.** Publish every price (credits per image, per call minute, per video second). Credits don't expire. Offer a stated refund path for crypto payers: store credit by default, or USDC back to the original sending address. Candy offers crypto payers nothing.
3. **Privacy you can state in writing.** Wallet or social login, no card descriptor, chats encrypted at rest, a short default retention period, a one-click "delete everything", and no training on user chats. Do **not** claim end-to-end encryption: the server has to read messages to run the model.
4. **Consent-first media and less railroading.** Unsolicited photos and voice notes are opt-in. Roleplay follows the user's lead.
5. **Crypto-native checkout.** USDC on Solana with no gas fee for the user, instant top-ups, on-chain receipts and global reach. No card processor can drop us.
6. **Verified-adult and safe by design**, presented as a trust signal rather than friction.

**What crypto genuinely adds:** no card-network adult-merchant rules, no chargebacks, no card descriptor, and an uncontested Solana niche. We found no serious Solana-native adult companion.

**What crypto does not do:**
- It removes no obligation. Age verification, CSAM controls, privacy law, tax and VAT all still apply.
- It adds OFAC sanctions exposure.
- It shrinks the market. One low-confidence guide puts crypto at a single-digit share of adult-creator revenue.
- It is not unique: Candy already advertises crypto.

**Contradiction between research areas:** the product research recommends a card-to-USDC on-ramp inside Privy (MoonPay or Coinbase). The payments research found that MoonPay's user terms bar "sexually oriented" transactions, Coinbase prohibits adult content, and Transak, Ramp and Stripe ban adult businesses. We go with the payments research: **no in-funnel card on-ramp** until a provider confirms in writing that it accepts us. Expect large drop-off among users who hold no crypto. That is the main commercial cost of this strategy.

## 3. What we need to build, layer by layer

**The rule that drives every vendor choice:** no major closed-model lab allows sexually explicit content through its API.
- Anthropic and Google prohibit it.
- OpenAI's adult mode has been on indefinite hold since 2026-03-26.
- xAI is unconfirmed and evidence leans towards "no".

We therefore use open-weight models behind our own provider-agnostic gateway, so we can switch providers within hours if one terminates us. We need **written confirmation** from every vendor whose terms are silent on adult content.

| Layer | Recommendation | Why | Cost | Alternative |
|---|---|---|---|---|
| Backend/data | Postgres + pgvector (Supabase) and Next.js route handlers | Supabase's AUP bans only CSAM and non-consensual imagery | Not researched (assume tens of $/mo) | AWS RDS (AUP bans only child exploitation) |
| App hosting | Keep Vercel for the app shell only; serve all explicit media from elsewhere | ⚠ **Vercel's AUP bans "obscene, graphic" content**, and its terms allow removal "for any reason" | Not researched | Self-host Next.js on an adult-tolerant host |
| Media storage/CDN | Cloudflare R2 or AWS S3/CloudFront | Neither AUP bans legal adult content | Small | Supabase Storage |
| Chat LLM | DeepSeek V4/V4.1-Flash or a Mistral-Small-24B roleplay finetune via DeepInfra or Featherless. GLM-5.x or Kimi as a premium "smarter" tier. Use non-reasoning mode. | Strong creative writing at about $0.09/$0.18 per 1M tokens. DeepInfra's and Featherless's terms are silent on adult content (unconfirmed). | ≈$0.30 per active user/mo (cheap tier); ≈$7 with GLM-5.3 (the $1.40/$4.40 per 1M price is unconfirmed) | OpenRouter pinned with `provider.only`, `allow_fallbacks=false`, `zdr=true` |
| Memory | Self-hosted: recent-turn window + rolling summaries + LLM-extracted facts with ADD/UPDATE/DELETE reconciliation, run during idle time; user-editable memory page | Keeps explicit logs away from a memory SaaS | ≈$0.05/user (bge-m3 embeddings at $0.01 per 1M tokens) | Mem0 ($19–249/mo; adult policy unknown) |
| Images | Z-Image-Turbo or Chroma1-HD (Apache 2.0, confirmed) for realistic; Animagine XL 4.0 (OpenRAIL++) for anime; one LoRA per official character; "send me a picture" as an LLM tool call | Licence-clean. Avoid NoobAI and FLUX.2-dev (non-commercial). | ≈$0.005–0.009 per image at fal list prices, but fal is excluded (see right), so explicit-capable hosting will cost more | ⚠ **fal's AUP bans sexually explicit content.** Replicate is ambiguous (its AUP bans "obscene" content). ⚠ RunPod, Modal and Together ban porn. NovoServe bare metal explicitly allows legal adult content (cost not researched). |
| Voice | Self-hosted Kokoro (voice notes) plus Chatterbox (MIT) for expressive voices. Calls on LiveKit Agents with Deepgram Nova-3 STT. | No hosted TTS vendor clearly permits erotic audio. ⚠ Fish Audio bans it. ElevenLabs is ambiguous. | ≈$0.025–0.05/min; LiveKit Ship $50/mo | Cartesia or Hume (silent on adult content; get written OK) |
| Video (later) | Wan 2.2 image-to-video (Apache 2.0) from an already-moderated character image | Identity and safety carry over from the source image | ≈$0.40 per 5s 720p clip hosted (fal price; self-hosted estimate similar) | LTX-2 (paid licence above $10M revenue) |
| Moderation | Text: OpenAI omni-moderation (free) + self-hosted gpt-oss-safeguard with our own policy. Prompts: blocklists for age terms and celebrity names. Images: Hive visual + celebrity detection, Thorn Safer, PhotoDNA if approved. | Defence in depth. Hash-matching alone misses newly generated CSAM. | Hive $3 per 1k images, $1.50 per 1k celebrity checks; Thorn pricing via sales. Hive pay-as-you-go caps at 100 req/day, so a contract is needed from day one. | Llama Guard 4, ShieldGemma 2. Whether OpenAI permits moderating non-OpenAI explicit content is **unverified**. |
| Age verification | Veriff Essential (document + liveness) | Meets the "highly effective" / ID-based standard | $0.80 per check, $49/mo minimum (confirmed) | Persona (about $250/mo); Ondato (€0.01–0.30). Self or World ID zk proofs only as a secondary option, since no regulator has endorsed them. |
| Auth / wallets | Privy with Solana embedded wallets plus Sign-In With Solana (SIWS) for Phantom and Solflare | Already integrated. Its AUP bans only *illegal* adult services. | Core $299/mo (500–2,499 MAU); Scale $499; above 10k MAU, $2,000 + $0.05/MAU | Privy is owned by Stripe, which bans adult content. Get written OK, and keep identity in our own DB so a Privy termination is survivable. |
| Payments | Self-built Solana Pay + Helius + Jupiter/Pyth (section 4) | ⚠ Sphere, Transak, Ramp, Stripe and Coinbase are ruled out. NOWPayments excludes US, EU and UK merchants. | Network fees + Helius $49–499/mo | MoonPay Commerce, only after written approval |

**Distribution:** web and PWA only. Apple guideline 1.1.4 and Google Play's sexual-content policy both prohibit this product.

## 4. Crypto payments architecture

**Payment flow:**
1. **Login.** Privy email/social login creates a Solana embedded wallet. Phantom and Solflare users sign in with SIWS.
2. **Catalog.** All plans and packs are priced in **USD**. USDC is the default; SOL is accepted.
3. **Order.** The server creates an order with: USD amount, a fresh reference public key, mint, exact token amount and expiry.
4. **SOL quotes.** Price SOL with Jupiter Price v3 and cross-check against Pyth Hermes. Reject the quote if the two differ by more than about 1%. Lock it for 10–15 minutes.
5. **Transaction.** A server-built Solana Pay transaction request: transfer to the treasury token account, plus the reference key and an order memo. Privy "App pays" gas sponsorship means USDC payers need no SOL. Rate-limit and cap sponsorship per user, because repeatedly opening and closing token accounts (ATAs) can drain the fee-payer wallet.
6. **Detection.** A Helius webhook on the treasury address (check the authHeader, return 200 fast, enqueue the work). A reconciliation job also polls open references every 15–30 seconds, because webhooks can be retried, duplicated or disabled.
7. **Verification.** Re-fetch the transaction from our own paid RPC and run `validateTransfer`. Check that the mint is the **canonical USDC mint**, the recipient and amount are correct, and the transaction has no error. Never treat the webhook payload as proof.
8. **Idempotency and finality.** UNIQUE constraints on the transaction signature and the order ID. Grant credits at `confirmed` and mark them settled at `finalized`.
9. **Ledger.** A double-entry ledger in Postgres. Credits are non-transferable and cannot be withdrawn or cashed out. Cap purchases well under $2,000 per account per day so the ledger stays inside FinCEN's closed-loop prepaid exclusion (that link is an inference and needs counsel to confirm).
10. **Sanctions.** Screen payer and refund addresses against sanctions lists. Geo-block sanctioned regions. Chainalysis's free API is **unconfirmed** for Solana.
11. **Treasury.** Hold funds in a multisig and sweep regularly.

**Subscriptions:**
- v1: prepaid periods ("30 days for $X USDC").
- v2: opt-in automatic renewal through Solana's native Subscriptions & Allowances program (on mainnet since June 2026, audited). Wallet support for its delegation flow is unverified, including Privy's.

**What to change in today's code:**
- Replace fixed-SOL prices with a USD catalog.
- Make the pack "Premium: unlimited" mean unlimited text only, not unlimited media.
- Delete the EVM-only `src/lib/wallet.ts`.
- Configure Privy for Solana: `toSolanaWalletConnectors`, `walletChainType: 'solana-only'`, Solana embedded wallets on.

**Token: don't.** Any revenue share, staking yield or price-linked perk is likely a security under the Howey test. SEC Release 33-11412 (March 2026) is interpretive, not a safe harbour, and the CLARITY Act failed cloture 49–50 on 2026-09-15. Companion tokens like SHELL, AIC and JOI carry a meme reputation. If we want something on-chain, the lowest-risk option is a non-transferable membership badge with no profit promise.

**Other limits:**
- Creator payouts must come out of Simulust's own revenue under a creator contract. Passing user payments through to creators risks being treated as money transmission.
- Book revenue at its USD fair market value when received.

## 5. Compliance

Today's click-through gate (`src/components/age-gate.tsx`) is **not enough** in any major regulated market:
- **UK:** Ofcom requires "highly effective age assurance". Actual fines include Itai Tech £50k (an AI nudify site) and AVS £1m. Further 2026 fines of £500k–£1.35m are unconfirmed.
- **EU:** the Commission's DSA Article 28 guidelines.
- **Australia:** Phase 2 codes cover AI companions (unconfirmed by fact-check).
- **US:** 25–27 states have adult-site age-verification laws (the sources disagree on the count).

**Launch blockers**

| # | Requirement | Laws |
|---|---|---|
| 1 | Real age assurance (ID + liveness) before any explicit content. Keep only the pass/fail result, not ID data. Otherwise geoblock the UK, EU/EEA, Australia and the US age-verification states. | FSC v. Paxton (2025); state statutes; **Texas HB 581** (applies to any public tool that can create sexual material harmful to minors, regardless of content share; $10k/day, plus $250k if a minor gets access); UK OSA Part 5 |
| 2 | CSAM prevention: adult age required on every character; youth and age-play terms blocked in text and image prompts; apparent-age classifier on every image, **including anime**; human review queue; **NCMEC CyberTipline registration**; reported content kept for 1 year | 18 USC 1466A (covers drawings and cartoons); 18 USC 2258A + REPORT Act (fines up to $600k/$850k); about 46 state laws; UK Crime and Policing Act 2026 |
| 3 | No real people: no face uploads, block celebrity names, 48-hour takedown form | TAKE IT DOWN Act (enforced since 2026-05-19, $53,088 per violation); Minnesota HF 1606 (up to $500k per use); Texas 129B.0045 |
| 4 | Companion safety for **all** users: AI disclosure at session start and every 3h; self-harm detection with crisis referral; crisis protocol published on the site; never present characters as therapists | NY GBL Art. 47 (up to $15k/day); CA SB 243 (private right of action); TN SB 1580 |
| 5 | Adult-tolerant infrastructure, with written vendor approvals | Vendor terms (section 3) |
| 6 | OFAC controls: geoblocking plus wallet screening; no withdrawals or peer-to-peer transfers | OFAC 2021 guidance (strict liability); FinCEN 2013/2019 |
| 7 | 18+ ToS, prohibited-content policy, privacy policy, report and appeal flow. **If serving the EU:** AI disclosure and machine-readable image marking from day one, and the Art. 5 ban on generating intimate imagery of identifiable people or CSAM from **2026-12-02** | EU AI Act Arts. 50 and 5 |

**Within about 60 days of launch:**
- DMCA agent registration (about $6).
- GDPR: explicit Art. 9 consent (sex-life data), a DPIA, and Art. 27 representatives. Italy fined Replika's operator €5M.
- CPRA sensitive-data notice.
- EU VAT via non-Union OSS, and UK VAT.
- Ofcom age-assurance records.

**Later:**
- WA HB 2225 and OR SB 1546 (2027-01-01).
- CA SB 1119: operator duties start **2027-07-01** per the CalMatters digest. The legal research said 2027-01-01, so plan for the earlier date.
- SB 243 annual reports (2027-07-01).
- NE, ID and GA laws (2027-07-01).
- UK Crime and Policing Act commencement orders.

## 6. Gap analysis against the current codebase

| Area | Today | Action |
|---|---|---|
| `src/app/layout.tsx` provider chain | PrivyApp > AgeGate > AuthProvider | **Keep** the structure; swap AgeGate for real verification |
| `src/components/age-gate.tsx` | Click-through stored in local/sessionStorage | **Replace** with a Veriff flow and a server-side `age_verified` flag |
| `src/components/privy-app.tsx` | Embedded wallets off; EVM-only wallet login | **Change:** Solana embedded wallets, Solana connectors, gas sponsorship with caps |
| `src/components/auth-gate.tsx` | Calls `usePrivy()` even when the app ID is missing (likely crash) | **Fix** |
| `src/lib/session.ts` | Mirrors the Privy user into localStorage | **Replace** with server-verified Privy tokens and a users table |
| `src/lib/wallet.ts`, `src/lib/google.ts`, `src/components/site-header.tsx` | Unused (EVM, old Google OAuth, dead re-export) | **Delete** |
| `src/app/page.tsx` + `src/lib/characters.ts` (~40 seed characters) | Hard-coded | **Keep** the UI; move characters to the DB with explicit adult ages; train one LoRA each |
| `public/` (~50MB images) | Committed to the repo | **Move** to R2/S3. **Review every image** for adult appearance. |
| `src/app/create/page.tsx` | Good creator flow; saves to localStorage; "Voice 1–6" placeholders | **Keep** the UI. Persist server-side. Require age ≥18. Map voices to real TTS voices. **Remove "petite" and "small" options** or enforce adult-appearance classification (CSAM risk, especially in the anime lane). |
| `src/app/api/portrait/route.ts` + `src/lib/portrait-prompt.ts` | Proxies Pollinations with `safe=false`; no auth, rate limit, moderation or storage; no Pollinations terms found | **Replace** with our own image service: auth, credits, prompt classifier, output moderation, storage |
| `src/app/date/[id]/page.tsx` | Canned replies; nothing persisted | **Wire up** a streaming LLM, memory, picture tool, AI disclosure and crisis detection |
| `src/lib/threads.ts`, `src/app/chat/page.tsx` | Stores only the last message, in localStorage | **Replace** with messages and threads tables |
| `src/app/profile/page.tsx` + `src/lib/profile.ts` | localStorage | **Move** to the DB; add export/delete |
| `src/components/shop.tsx`, `src/lib/packs.ts`, `src/components/shop-pay.tsx` | Fixed SOL prices; "Unlimited" plan; stub checkout | **Rebuild:** USD catalog, published per-action prices, real Solana Pay checkout, no memory upsell |
| Cross-cutting | No moderation, rate limiting, analytics or tests | **Add** all four. Payment-verifier tests come first (duplicate webhook, underpayment, wrong mint, expired quote). |

## 7. Phased roadmap

Effort assumes 2–3 engineers.

**MVP: verified-adult chat with images, paid in USDC or SOL (about 10–14 weeks)**
- Backend, DB and auth fixes.
- Real LLM with persistent, user-editable memory.
- In-chat images for official characters plus the creator, on approved hosting.
- Full safety pipeline and NCMEC registration.
- Veriff age verification.
- Companion-law disclosures and crisis protocol.
- Prepaid USDC/SOL checkout and the credits ledger.
- Published pricing page; legal documents.
- Launch in a limited set of regions, geoblocking where obligations are unmet. A **text-first** launch is a smaller fallback: explicit text-only content is outside UK OSA Part 5, though it is unclear whether US state laws cover text.

**v1 (about 3 months after MVP)**
- Voice notes and LiveKit voice calls.
- Premium model tier.
- PWA push for opt-in proactive messages.
- Automatic USDC renewals via Solana Subscriptions.
- GDPR, VAT and DMCA housekeeping.
- Analytics.

**v2 (about 3–6 months after v1)**
- Wan 2.2 video clips.
- Group chats.
- Story mode.
- Creator marketplace, paid from our own revenue after counsel review.
- Optional zk age-proof route.

## 8. Rough monthly cost

**Assumptions:**
- 10% of MAU pay about $12/mo.
- Payers use the moderate profile: 800 messages, 30 images and 30 call-minutes.
- Free users are capped at about $0.05–0.25 each.
- Half of MAU are new and verify their age each month.
- Video is excluded (v2).
- GPU hosting uses dedicated adult-tolerant hosts. These are priced off RunPod benchmarks; actual host prices are unknown.

| Line | ~1,000 MAU | ~10,000 MAU |
|---|---|---|
| Chat LLM + memory (cheap tier) | $50–100 | $500–1,000 |
| Image + TTS GPUs (always-on, adult-tolerant) | $300–700 | $1,000–2,500 |
| Voice calls (STT, LiveKit) | $100–200 | $900–1,500 |
| Moderation (Hive; Thorn via sales, TBD) | $25–50 + Thorn | $200–300 + Thorn |
| Age verification ($0.80/check) | ~$400 | ~$4,000 |
| Privy | $299 | ~$2,500 (pay-as-you-go) or negotiated |
| Helius / RPC | $49 | $49–499 |
| DB, app hosting, storage (not researched) | $100–200 | $300–800 |
| **Total** | **≈$1.3k–2.0k** | **≈$9.5k–13k** |
| Implied subscription revenue | ≈$1.2k | ≈$12k + credit packs |

**What this shows:**
- At 1,000 MAU we lose money; fixed costs dominate.
- At 10,000 MAU, age verification and Privy are the biggest lines, not AI.
- **Levers:**
  - Verify age only when a user unlocks explicit content or pays, and keep the free preview non-explicit.
  - Negotiate with Privy, or rely more on external-wallet SIWS.
  - Use pay-per-use image hosting at low volume.
- One-off legal counsel is not included in these figures.

## 9. Decisions the team must make now

1. **Entity and launch regions.** Where we incorporate, and which countries and US states we geoblock at MVP.
2. **Explicit images at launch, or text-first?**
3. **Age verification:** vendor, and where it sits in the funnel.
4. **Anime lane and "petite/small" options:** keep them with strict adult-appearance controls, or cut them for launch.
5. **Privy:** request written approval now, and decide the fallback if they refuse.
6. **Vercel:** keep it for the app shell only, or move off now.
7. **Payments:** confirm USDC-first, SOL accepted, no token, no in-funnel card on-ramp.
8. **Budget:** adult-industry counsel and about $1.5–2k/mo of runway at 1k MAU.

---

## Sources
1. https://candy.ai/terms-of-service
2. https://www.roborhythms.com/candy-ai-pricing/
3. https://www.trustpilot.com/review/candy.ai
4. https://kindroid.ai/v2/docs/subscriptions/
5. https://www.ourdream.ai/
6. https://www.anthropic.com/legal/aup
7. https://fal.ai/legal/acceptable-use-policy
8. https://www.runpod.io/legal/terms-of-service
9. https://deepinfra.com/pricing
10. https://openrouter.ai/docs/features/provider-routing
11. https://thehive.ai/pricing
12. https://livekit.com/pricing
13. https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests
14. https://www.helius.dev/docs/webhooks
15. https://solana.com/news/subscriptions-and-allowances
16. https://privy.io/acceptable-use-policy
17. https://www.privy.io/pricing
18. https://nowpayments.io/doc/fd-tos.pdf?v=1.4.2
19. https://www.moonpay.com/legal/terms_of_use_usa
20. https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering
21. https://capitol.texas.gov/tlodocs/89R/billtext/html/HB00581F.htm
22. https://www.law.cornell.edu/uscode/text/18/2258A
23. http://www.wilmerhale.com/en/insights/client-alerts/20260615-the-take-it-down-act-goes-live
24. https://www.nysenate.gov/legislation/laws/GBS/1702
25. https://vercel.com/legal/acceptable-use-policy