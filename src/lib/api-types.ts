// Shapes returned by the API, shared by route handlers and client components.
// Dates are ISO strings on the wire.

import type { Character } from "@/lib/characters";

export type AgeStatus = "none" | "pending" | "approved" | "declined";

export type Me = {
  id: string;
  // The login name of a username account (null for dev and older accounts).
  username: string | null;
  displayName: string;
  isAdmin: boolean;
  ageStatus: AgeStatus;
  // A confirmed adult with no explicit hold: everything explicit is open to
  // them. There's no separate explicit switch; the whole site is uncensored.
  ageVerified: boolean;
  // Gave a date of birth of 18 or over at sign-up (no ID involved).
  ageAttested: boolean;
  // Said they're under 18: explicit content is off until an admin reviews it.
  explicitHold: boolean;
  memberUntil: string | null;
  isMember: boolean;
  settings: { unpromptedMedia: boolean };
  balance: number;
  freeMessagesLeft: number;
};

export type Features = {
  payments: boolean;
  // "gate": adults confirm a date of birth in the app (the default, no ID).
  // Otherwise ID checks: through Veriff, the development stand-in, or off.
  ageVerification: "gate" | "veriff" | "dev" | "off";
  voice: boolean;
  video: boolean;
  images: "worker" | "pollinations" | "mock";
  solanaCluster: "mainnet" | "devnet";
};

export type MeResponse = { me: Me | null; features: Features };

export type CharacterDTO = Character;

export type MediaDTO = {
  id: string;
  kind: "image" | "audio" | "video";
  status: "pending" | "ready" | "failed" | "blocked";
  url: string | null;
  error?: string | null;
  // Explicit media the viewer can't see right now (an explicit hold, or no age
  // confirmation yet): no URL, shown as a locked 18+ tile.
  locked?: boolean;
};

export type MessageDTO = {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  createdAt: string;
  media: MediaDTO | null;
  // Voice note made from this message, and video animated from its photo.
  voice?: MediaDTO | null;
  video?: MediaDTO | null;
};

export type ThreadDTO = {
  id: string;
  character: CharacterDTO;
  lastPreview: string;
  lastMessageAt: string;
};

export type MemoryDTO = {
  id: string;
  characterId: string;
  kind: "fact" | "preference" | "event" | "boundary";
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

// Streamed chat replies are newline-delimited JSON, one event per line.
export type ChatStreamEvent =
  | { type: "user"; message: MessageDTO }
  | { type: "delta"; text: string }
  | { type: "done"; message: MessageDTO; balance: number; freeMessagesLeft: number }
  | { type: "notice"; message: MessageDTO }
  | { type: "crisis"; resources: CrisisResource[] }
  | { type: "error"; error: string; code?: string };

export type CrisisResource = { label: string; detail: string; href?: string };

export type OrderDTO = {
  id: string;
  productId: string;
  usdCents: number;
  currency: "USDC" | "SOL";
  amount: string;
  amountDisplay: string;
  recipient: string;
  reference: string;
  status: "pending" | "confirmed" | "finalized" | "expired" | "failed" | "underpaid" | "blocked" | "refund_due";
  signature: string | null;
  expiresAt: string;
  solanaPayUrl: string;
};

export type LedgerEntryDTO = {
  id: number;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
};

export type CreditsResponse = { balance: number; ledger: LedgerEntryDTO[] };

export type OrdersResponse = { orders: OrderDTO[] };

export type ProfileGender = "Woman" | "Man" | "Non-binary";
export type ProfileLane = "Girls" | "Anime" | "Guys";

export type ProfileDTO = {
  name: string;
  gender: ProfileGender;
  looking: ProfileLane[];
  bio: string;
  updatedAt: string;
};

export type ApiErrorBody = { error: string; code?: string };
