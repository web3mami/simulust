// Shared catalog. Prices are set in USD and settled in USDC or SOL at checkout.
// Credits never expire and cannot be withdrawn or transferred.

export type ProductId = "credits-500" | "credits-1100" | "credits-3000" | "credits-6500" | "member-30";

export type Product = {
  id: ProductId;
  name: string;
  usdCents: number;
  credits: number;
  memberDays?: number;
  tag?: string;
  perks: string[];
  featured?: boolean;
};

export const PRODUCTS: Product[] = [
  {
    id: "credits-500",
    name: "Spark",
    usdCents: 499,
    credits: 500,
    perks: ["500 credits", "Never expire"],
  },
  {
    id: "credits-1100",
    name: "Ember",
    usdCents: 999,
    credits: 1100,
    tag: "+10% bonus",
    perks: ["1,100 credits", "Never expire"],
  },
  {
    id: "credits-3000",
    name: "Heat",
    usdCents: 2499,
    credits: 3000,
    tag: "+20% bonus",
    perks: ["3,000 credits", "Never expire"],
    featured: true,
  },
  {
    id: "credits-6500",
    name: "Inferno",
    usdCents: 4999,
    credits: 6500,
    tag: "+30% bonus",
    perks: ["6,500 credits", "Never expire"],
  },
];

export const MEMBERSHIP: Product = {
  id: "member-30",
  name: "Member",
  usdCents: 1299,
  credits: 400,
  memberDays: 30,
  tag: "30 days, prepaid",
  // Only what membership really adds: free users get the same memory and
  // replies, and credits never expire for anyone.
  perks: [
    "Unlimited messages (fair use)",
    "400 credits for photos, voice and video",
    "No auto-renew. Top up when you want.",
  ],
  featured: true,
};

export const ALL_PRODUCTS: Product[] = [...PRODUCTS, MEMBERSHIP];

export function findProduct(id: string): Product | undefined {
  return ALL_PRODUCTS.find((product) => product.id === id);
}

// What each action costs, in credits. Published on the pricing page as-is.
export const COSTS = {
  message: 1,
  photo: 8,
  voiceNote: 4,
  video: 60,
  portrait: 8,
} as const;

export type CostKey = keyof typeof COSTS;

export const FREE = {
  signupCredits: 50,
  dailyMessages: 25,
} as const;

// Members get unlimited messages, but a fair-use ceiling keeps one account from
// running the model around the clock.
export const MEMBER_DAILY_MESSAGE_CAP = 600;

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatCredits(credits: number) {
  return `${credits.toLocaleString("en-US")} credits`;
}
