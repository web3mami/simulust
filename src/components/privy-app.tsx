"use client";

import {
  createWalletCreationOnLoginPlugin,
  PrivyProvider,
} from "@privy-io/react-auth";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

const skipWalletOnLogin = createWalletCreationOnLoginPlugin({
  shouldCreateWallet: () => false,
});

export function isPrivyConfigured() {
  return APP_ID.length > 0;
}

export function PrivyApp({ children }: { children: React.ReactNode }) {
  if (!isPrivyConfigured()) {
    return children;
  }

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["google", "twitter", "wallet"],
        appearance: {
          theme: "#12110F",
          accentColor: "#C6A15B",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "off",
          },
          solana: {
            createOnLogin: "off",
          },
          showWalletUIs: false,
        },
        plugins: [skipWalletOnLogin],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
