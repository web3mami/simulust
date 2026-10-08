"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LoginScreen } from "@/components/login-screen";
import {
  clearSession,
  sessionFromPrivyUser,
  writeSession,
  type Session,
} from "@/lib/session";

type AuthIntent = "login" | "signup";

type AuthValue = {
  session: Session | null;
  signOut: () => void;
  openLogin: () => void;
  openSignup: () => void;
};

const SessionContext = createContext<AuthValue | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside AuthProvider");
  }
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { ready, authenticated, user, logout } = usePrivy();
  const [loginOpen, setLoginOpen] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent>("login");

  const session =
    ready && authenticated && user ? sessionFromPrivyUser(user) : null;

  useEffect(() => {
    if (!ready) return;
    const oauthReturn = new URLSearchParams(window.location.search).has(
      "privy_oauth_code",
    );
    if (session) {
      writeSession(session);
      setLoginOpen(false);
      if (oauthReturn) router.replace("/profile");
      return;
    }
    if (oauthReturn) return;
    clearSession();
  }, [ready, session, router]);

  function signOut() {
    clearSession();
    void logout();
  }

  return (
    <SessionContext.Provider
      value={{
        session,
        signOut,
        openLogin: () => {
          setAuthIntent("login");
          setLoginOpen(true);
        },
        openSignup: () => {
          setAuthIntent("signup");
          setLoginOpen(true);
        },
      }}
    >
      {children}
      {loginOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--bg)]">
            <div className="flex justify-end px-4 pt-4">
              <button
                type="button"
                className="text-sm text-[var(--muted)]"
                onClick={() => setLoginOpen(false)}
              >
                Close
              </button>
            </div>
            <LoginScreen
              embedded
              intent={authIntent}
              onSignedIn={() => setLoginOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </SessionContext.Provider>
  );
}
