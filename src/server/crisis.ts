import "server-only";
import type { CrisisResource } from "@/lib/api-types";

// Shown when a message suggests self-harm or suicide (NY GBL Art. 47, CA SB 243
// require a referral to crisis services). Keep this list, the two texts below
// and the published crisis protocol on /safety in sync.
export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    label: "United States and Canada",
    detail: "Call or text 988, the Suicide & Crisis Lifeline. Free, any time.",
    href: "tel:988",
  },
  {
    label: "UK and Ireland",
    detail: "Call Samaritans on 116 123. Free, any time.",
    href: "tel:116123",
  },
  {
    label: "Anywhere else",
    detail: "Find a free, confidential helpline in your country at findahelpline.com.",
    href: "https://findahelpline.com",
  },
];

export function crisisResources(): CrisisResource[] {
  return CRISIS_RESOURCES.map((resource) => ({ ...resource }));
}

// The same resources in one line, for the model to mention in its own words.
export const CRISIS_RESOURCES_TEXT =
  "In the US and Canada, call or text 988. In the UK and Ireland, call Samaritans on 116 123. Anywhere else, findahelpline.com lists free local helplines. If they are in immediate danger, they should call their local emergency number.";

// The note saved in the chat on every crisis turn, whatever happens to the
// message itself (refused, out of credits). Unlike the resource card it stays
// in the history.
export const CRISIS_NOTICE =
  "You don't have to go through this alone. In the US and Canada, call or text 988. In the UK and Ireland, call Samaritans on 116 123. Anywhere else, findahelpline.com lists free, confidential helplines. If you're in immediate danger, call your local emergency number.";

// What a crisis turn's reply becomes if it fails moderation, in place of the
// usual change of subject. It follows CRISIS_NOTICE in the chat.
export const CRISIS_FALLBACK_REPLY =
  "I'm really glad you told me, and I'm here with you. Please reach out to one of the lines above: they're free, confidential and there any time. Are you safe right now?";
