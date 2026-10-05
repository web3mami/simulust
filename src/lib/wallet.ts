import type { Session } from "@/lib/session";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type InjectedProvider = Eip1193 & {
  providers?: InjectedProvider[];
  isMetaMask?: boolean;
};

function injectedProvider(): Eip1193 | undefined {
  const ethereum = (
    window as Window & { ethereum?: InjectedProvider }
  ).ethereum;
  if (!ethereum) return undefined;
  const providers = ethereum.providers;
  if (providers?.length) {
    return providers.find((provider) => provider.isMetaMask) ?? providers[0];
  }
  return ethereum;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function signInWithProvider(provider: Eip1193): Promise<Session> {
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts[0];
  if (!address) {
    throw new Error("The wallet did not return an account.");
  }

  try {
    await provider.request({
      method: "personal_sign",
      params: [`Sign in to Simulust\n${address}`, address],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4001) {
      throw new Error("Wallet sign-in was cancelled.");
    }
    throw new Error("The wallet did not sign you in.");
  }

  return {
    provider: "wallet",
    display: shortAddress(address),
    detail: address,
  };
}

export async function signInWithWallet(): Promise<Session> {
  const injected = injectedProvider();
  if (injected) return signInWithProvider(injected);

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "No wallet in this browser. Install MetaMask, or turn on WalletConnect.",
    );
  }

  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const walletConnect = await EthereumProvider.init({
    projectId,
    showQrModal: true,
    optionalChains: [8453, 1],
    metadata: {
      name: "Simulust",
      description: "AI dating",
      url: window.location.origin,
      icons: ["https://walletconnect.com/walletconnect-logo.png"],
    },
  });

  try {
    await walletConnect.connect();
  } catch {
    throw new Error("WalletConnect was cancelled.");
  }

  return signInWithProvider(walletConnect);
}
