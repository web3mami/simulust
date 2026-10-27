import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type UserSettings = {
  // Characters only send photos or voice notes on their own when the user opts in.
  unpromptedMedia?: boolean;
  // Explicit content stays off until the user is verified and turns it on.
  explicit?: boolean;
  // When explicit content was first turned on: the record of GDPR Art. 9 consent.
  explicitConsentAt?: string;
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  privyId: text("privy_id").notNull().unique(),
  displayName: text("display_name").notNull().default("You"),
  walletAddress: text("wallet_address"),
  isAdmin: boolean("is_admin").notNull().default(false),
  ageStatus: text("age_status", { enum: ["none", "pending", "approved", "declined"] })
    .notNull()
    .default("none"),
  ageVerifiedAt: timestamp("age_verified_at", { withTimezone: true }),
  memberUntil: timestamp("member_until", { withTimezone: true }),
  settings: jsonb("settings").$type<UserSettings>().notNull().default({}),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  photoMediaId: uuid("photo_media_id"),
  gender: text("gender").notNull().default("Man"),
  looking: text("looking").array().notNull().default(sql`'{}'::text[]`),
  bio: text("bio").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const characters = pgTable(
  "characters",
  {
    id: text("id").primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    age: integer("age").notNull(),
    gender: text("gender").notNull(),
    ethnicity: text("ethnicity").notNull(),
    body: text("body").notNull(),
    role: text("role").notNull(),
    heat: text("heat").notNull(),
    line: text("line").notNull(),
    color: text("color").notNull().default("#3a3348"),
    lane: text("lane", { enum: ["girls", "anime", "guys"] }).notNull(),
    style: text("style", { enum: ["realistic", "anime"] }).notNull().default("realistic"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    imageUrl: text("image_url"),
    imageMediaId: uuid("image_media_id"),
    hair: text("hair"),
    hairStyle: text("hair_style"),
    eyeColor: text("eye_color"),
    breast: text("breast"),
    personality: text("personality"),
    occupation: text("occupation"),
    kinks: text("kinks").array().notNull().default(sql`'{}'::text[]`),
    voice: text("voice"),
    // Per-character image model add-on (LoRA) on the image worker, for a consistent face.
    loraId: text("lora_id"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("characters_adult", sql`${table.age} >= 18`),
    index("characters_owner_idx").on(table.ownerId),
  ],
);

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    lastPreview: text("last_preview").notNull().default(""),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    // Rolling summary of everything older than the recent window.
    summary: text("summary").notNull().default(""),
    summarizedCount: integer("summarized_count").notNull().default(0),
    // Bumped by "forget everything", so memory work that started before it
    // can't write the forgotten content back.
    memoryEpoch: integer("memory_epoch").notNull().default(0),
    // When the "you're talking to an AI" notice was last shown (companion laws).
    disclosedAt: timestamp("disclosed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("threads_user_character_idx").on(table.userId, table.characterId),
    index("threads_user_recent_idx").on(table.userId, table.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "notice"] }).notNull(),
    content: text("content").notNull(),
    mediaId: uuid("media_id"),
    creditsSpent: integer("credits_spent").notNull().default(0),
    flagged: boolean("flagged").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index("messages_thread_idx").on(table.threadId, table.createdAt)],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["fact", "preference", "event", "boundary"] }).notNull().default("fact"),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    sourceMessageId: uuid("source_message_id"),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("memories_owner_idx").on(table.userId, table.characterId)],
);

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    characterId: text("character_id"),
    threadId: uuid("thread_id"),
    kind: text("kind", { enum: ["image", "audio", "video"] }).notNull(),
    purpose: text("purpose", { enum: ["portrait", "chat", "voice", "video", "avatar"] }).notNull(),
    status: text("status", { enum: ["pending", "ready", "failed", "blocked"] }).notNull().default("pending"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    prompt: text("prompt"),
    sourceMediaId: uuid("source_media_id"),
    jobId: text("job_id"),
    moderation: jsonb("moderation").$type<Record<string, unknown>>(),
    creditsSpent: integer("credits_spent").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_user_idx").on(table.userId, table.createdAt),
    uniqueIndex("media_job_idx").on(table.jobId),
    // Takedowns follow these to everything made from an item or a character.
    index("media_source_idx").on(table.sourceMediaId),
    index("media_character_idx").on(table.characterId),
    // The cron's sweep for abandoned and stuck work.
    index("media_pending_idx").on(table.createdAt).where(sql`${table.status} = 'pending'`),
  ],
);

export const creditBalances = pgTable(
  "credit_balances",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("credit_balances_non_negative", sql`${table.balance} >= 0`)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason", {
      enum: ["signup", "purchase", "membership", "message", "photo", "portrait", "voice", "video", "refund", "admin"],
    }).notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("credit_ledger_user_idx").on(table.userId, table.createdAt),
    // Refunds look up what was charged for a message or media item.
    index("credit_ledger_charge_idx").on(table.refId),
    // A purchase or refund can only ever be credited once.
    uniqueIndex("credit_ledger_ref_idx")
      .on(table.reason, table.refType, table.refId)
      .where(sql`${table.refId} is not null and ${table.reason} in ('purchase', 'membership', 'refund')`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Kept (unlinked) when the account is deleted: payment records are needed for tax.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    productId: text("product_id").notNull(),
    usdCents: integer("usd_cents").notNull(),
    currency: text("currency", { enum: ["USDC", "SOL"] }).notNull(),
    mint: text("mint"),
    // Smallest units (USDC: 6 decimals, SOL: lamports), kept as text-safe bigint.
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    recipient: text("recipient").notNull(),
    reference: text("reference").notNull().unique(),
    quote: jsonb("quote").$type<Record<string, unknown>>(),
    // refund_due: a payment arrived that can't be credited (too long after the
    // checkout closed, over the daily cap, or the account was deleted, banned or
    // age-locked). Support screens the payer, then refunds its signature by hand.
    status: text("status", {
      enum: ["pending", "confirmed", "finalized", "expired", "failed", "underpaid", "blocked", "refund_due"],
    })
      .notNull()
      .default("pending"),
    signature: text("signature").unique(),
    // Where a refund goes: the address the paid asset left in the largest amount.
    payer: text("payer"),
    // Everyone screened for that payment: every signer and every owner the paid asset left.
    payers: text("payers").array().notNull().default(sql`'{}'::text[]`),
    error: text("error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("orders_user_idx").on(table.userId, table.createdAt), index("orders_status_idx").on(table.status)],
);

// A payment that reached the treasury for an order but wasn't credited: a short
// one, or one after the order already had a payment. One row per transaction,
// holding what it actually sent, so no payment is refunded twice. Support
// screens the payer, then refunds each signature once, by hand.
export const extraPayments = pgTable(
  "extra_payments",
  {
    signature: text("signature").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    reason: text("reason", { enum: ["short", "repeat"] }).notNull(),
    // Where a refund goes: the address the paid asset left in the largest amount.
    payer: text("payer"),
    // What reached the treasury, in the smallest units of the order's currency.
    received: bigint("received", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("extra_payments_order_idx").on(table.orderId)],
);

// Transactions the payment checks have judged against every order they name,
// or that can't pay any order (failed, or sent the treasury nothing), so they
// are never read from the chain again. Kept for a day, well past any order's watch.
export const checkedSignatures = pgTable("checked_signatures", {
  signature: text("signature").primaryKey(),
  createdAt: createdAt(),
});

// How far the reconcile scan has got on each account payments land on (the
// treasury wallet for SOL, its USDC account for USDC). Each run carries on from
// here rather than from the newest transactions, so junk landing on the account
// after a payment can't push the payment out of the scan's reach.
export const scanCursors = pgTable("scan_cursors", {
  account: text("account").primaryKey(),
  // Every transaction on the account up to and including this one is dealt with.
  until: text("until"),
  // Where listing stopped in runs that couldn't list all the way down to
  // `until`, newest first. The scan works through the gap below the last one.
  marks: text("marks").array().notNull().default(sql`'{}'::text[]`),
  // A listed transaction our RPC couldn't return, and for how many runs in a row.
  stuck: text("stuck"),
  stuckRuns: integer("stuck_runs").notNull().default(0),
  // Bumped on every save, so two overlapping runs can't overwrite each other.
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ageChecks = pgTable("age_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["veriff", "dev"] }).notNull(),
  sessionId: text("session_id").notNull().unique(),
  // Only the outcome is kept. No document images or ID data are stored.
  status: text("status", { enum: ["created", "submitted", "approved", "declined", "expired", "resubmission"] })
    .notNull()
    .default("created"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterUserId: uuid("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
    reporterEmail: text("reporter_email"),
    kind: text("kind", { enum: ["ncii", "csam", "real_person", "copyright", "other"] }).notNull(),
    target: text("target").notNull(),
    details: text("details").notNull().default(""),
    status: text("status", { enum: ["open", "actioned", "dismissed"] }).notNull().default("open"),
    // TAKE IT DOWN Act: valid removal requests must be handled within 48 hours.
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolution: text("resolution"),
    createdAt: createdAt(),
  },
  (table) => [index("reports_status_idx").on(table.status, table.dueAt)],
);

export const moderationEvents = pgTable(
  "moderation_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    targetType: text("target_type", {
      enum: ["message", "character", "image_prompt", "image", "video", "audio", "profile", "report"],
    }).notNull(),
    targetId: text("target_id"),
    category: text("category").notNull(),
    action: text("action", { enum: ["blocked", "flagged", "allowed", "escalated"] }).notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("moderation_events_open_idx").on(table.action, table.reviewedAt),
    // Evidence checks: what was found on a reported item, and a user's recent
    // minor-related events before their account can be deleted.
    index("moderation_events_target_idx").on(table.targetId),
    index("moderation_events_user_idx").on(table.userId, table.category, table.createdAt),
  ],
);

// Hashes of deleted accounts' login ids, so signing up again with the same
// login doesn't grant the free signup credits a second time.
export const deletedIdentities = pgTable("deleted_identities", {
  privyIdHash: text("privy_id_hash").primaryKey(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type ExtraPayment = typeof extraPayments.$inferSelect;
