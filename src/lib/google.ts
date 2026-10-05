import type { Session } from "@/lib/session";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
};

type GoogleTokenClient = {
  requestAccessToken: () => void;
};

type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: GoogleTokenResponse) => void;
      }) => GoogleTokenClient;
    };
  };
};

type GoogleProfile = {
  email?: string;
  name?: string;
  sub?: string;
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

function loadGoogleScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-simulust-google]",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Could not reach Google.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.simulustGoogle = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not reach Google."));
    document.head.appendChild(script);
  });
}

export async function signInWithGoogle(): Promise<Session> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Google sign-in is not set up on this server yet.");
  }

  await loadGoogleScript();
  const google = window.google;
  if (!google?.accounts?.oauth2) {
    throw new Error("Google sign-in did not load.");
  }

  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error("Google sign-in was cancelled."));
          return;
        }
        resolve(response.access_token);
      },
    });
    client.requestAccessToken();
  });

  const profileResponse = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!profileResponse.ok) {
    throw new Error("Google did not return an account.");
  }

  const profile = (await profileResponse.json()) as GoogleProfile;
  const display = profile.name || profile.email;
  if (!display || !profile.sub) {
    throw new Error("Google did not return an account.");
  }

  return {
    provider: "google",
    display,
    detail: profile.email || profile.sub,
  };
}
