"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

// A production build fails without these (next.config.ts), and the server won't
// boot if they disagree with its own config. A build inlines unset ones as "",
// hence || rather than ??.
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet" ? "mainnet" : "devnet";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (CLUSTER === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");

export function isPrivyConfigured() {
  return APP_ID.length > 0;
}

export const solanaChain = CLUSTER === "mainnet" ? ("solana:mainnet" as const) : ("solana:devnet" as const);

const solanaConnectors = toSolanaWalletConnectors();

export function PrivyApp({ children }: { children: React.ReactNode }) {
  if (!isPrivyConfigured()) {
    return children;
  }

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter", "wallet"],
        appearance: {
          theme: "#12110F",
          accentColor: "#C6A15B",
          walletChainType: "solana-only",
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          // Email and social users get a Solana wallet to pay from. Users who
          // log in with Phantom or Solflare keep using their own wallet.
          solana: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
        solana: {
          rpcs: {
            [solanaChain]: {
              rpc: createSolanaRpc(RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws")),
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
