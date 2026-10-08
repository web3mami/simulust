export type ShopOffer = {
  id: "ember" | "heat" | "inferno" | "premium";
  name: string;
  tag?: string;
  sol: number;
  save?: number;
  perks: string[];
  highlights: string[];
  featured?: boolean;
};

export const PACKS: ShopOffer[] = [
  {
    id: "ember",
    name: "Ember",
    sol: 0.08,
    perks: [
      "200 messages",
      "20 portraits",
      "3-day memory",
      "Standard queue",
    ],
    highlights: ["200 messages", "20 portraits", "3-day memory"],
  },
  {
    id: "heat",
    name: "Heat",
    tag: "Best value",
    sol: 0.22,
    save: 20,
    perks: [
      "Everything in Ember",
      "800 messages",
      "80 portraits",
      "14-day memory",
      "Voice notes",
      "Faster replies",
    ],
    featured: true,
    highlights: ["800 messages", "14-day memory", "Voice notes"],
  },
  {
    id: "inferno",
    name: "Inferno",
    sol: 0.55,
    save: 40,
    perks: [
      "Everything in Heat",
      "2,000 messages",
      "200 portraits",
      "45-day memory",
      "HD portraits",
      "Priority queue",
      "2 extra custom characters",
    ],
    highlights: ["2,000 messages", "HD portraits", "Priority queue"],
  },
];

export const PREMIUM: ShopOffer = {
  id: "premium",
  name: "Premium",
  tag: "All perks, then more",
  sol: 1.2,
  perks: [
    "Everything in Inferno",
    "Unlimited messages",
    "Unlimited portraits",
    "Memory that stays",
    "Skip the queue",
    "Voice, and video when it lands",
    "Exclusive characters",
    "10 custom characters",
    "Early features",
  ],
  highlights: [
    "Unlimited messages",
    "Memory that stays",
    "Exclusive characters",
    "Skip the queue",
  ],
  featured: true,
};

export function formatSol(amount: number) {
  return `${amount} SOL`;
}

export function formatSave(percent: number) {
  return `Save ${percent}%`;
}
