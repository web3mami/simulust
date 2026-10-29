"use client";

import { PrivyProvider } from "@privy-io/react-auth";
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

// Privy is only the wallet here. People sign in with a username and password;
// WalletSync (wallet-sync.tsx) signs Privy in with our own token and creates the
// account's Solana wallet. Privy's login modal is never opened. Other wallets
// (Phantom, Solflare) pay through Solana Pay, so none are connected here.
export function PrivyApp({ children }: { children: React.ReactNode }) {
  if (!isPrivyConfigured()) {
    return children;
  }

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        appearance: {
          theme: "#12110F",
          accentColor: "#C6A15B",
          walletChainType: "solana-only",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          // JWT-based auth never triggers this; WalletSync creates the wallet.
          solana: { createOnLogin: "off" },
          // Privy's confirmation window before the wallet signs a payment.
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
