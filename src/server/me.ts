import "server-only";
import { balanceOf, freeMessagesLeft } from "@/server/credits";
import { isAgeVerified, isMember } from "@/server/auth";
import { env, features } from "@/server/env";
import type { User } from "@/server/db/schema";
import type { Features, Me } from "@/lib/api-types";

export async function toMe(user: User): Promise<Me> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    ageStatus: user.ageStatus,
    ageVerified: isAgeVerified(user),
    ageAttested: user.ageAttestedAt !== null,
    explicitHold: user.explicitHoldAt !== null,
    memberUntil: user.memberUntil?.toISOString() ?? null,
    isMember: isMember(user),
    settings: {
      unpromptedMedia: user.settings.unpromptedMedia === true,
    },
    balance: await balanceOf(user.id),
    freeMessagesLeft: await freeMessagesLeft(user),
  };
}

export function publicFeatures(): Features {
  return {
    payments: features.payments,
    ageVerification:
      env.ageVerification === "gate" ? "gate" : features.veriff ? "veriff" : env.allowDevAgeCheck ? "dev" : "off",
    voice: features.tts,
    video: Boolean(env.videoApiUrl) || env.imageProvider === "mock",
    images: env.imageProvider,
    solanaCluster: env.solanaCluster,
  };
}
