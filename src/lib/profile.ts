export type ProfileGender = "Woman" | "Man" | "Non-binary";
export type ProfileLane = "Girls" | "Anime" | "Guys";

export type UserProfile = {
  owner: string;
  name: string;
  photo: string;
  gender: ProfileGender;
  looking: ProfileLane[];
  bio: string;
};

export const PROFILE_KEY = "simulust-profile";

function readAll(): Record<string, UserProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, UserProfile>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadProfile(owner: string): UserProfile | null {
  const profile = readAll()[owner];
  if (!profile?.name?.trim()) return null;
  return profile;
}

export function saveProfile(profile: UserProfile) {
  const all = readAll();
  all[profile.owner] = profile;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
}

export function clearProfile(owner: string) {
  const all = readAll();
  delete all[owner];
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
}
