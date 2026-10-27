import "server-only";
import { balanceOf, freeMessagesLeft } from "@/server/credits";
import { isAgeVerified, isMember } from "@/server/auth";
import { env, features } from "@/server/env";
import type { User } from "@/server/db/schema";
import type { Features, Me } from "@/lib/api-types";

export async function toMe(user: User): Promise<Me> {
  return {
    id: user.id,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    ageStatus: user.ageStatus,
    ageVerified: isAgeVerified(user),
    memberUntil: user.memberUntil?.toISOString() ?? null,
    isMember: isMember(user),
    settings: {
      explicit: isAgeVerified(user) && user.settings.explicit === true,
      unpromptedMedia: user.settings.unpromptedMedia === true,
    },
    balance: await balanceOf(user.id),
    freeMessagesLeft: await freeMessagesLeft(user),
  };
}

export function publicFeatures(): Features {
  return {
    payments: features.payments,
    ageVerification: features.veriff ? "veriff" : env.allowDevAgeCheck ? "dev" : "off",
    voice: features.tts,
    video: Boolean(env.videoApiUrl) || env.imageProvider === "mock",
    images: env.imageProvider,
    solanaCluster: env.solanaCluster,
  };
}
