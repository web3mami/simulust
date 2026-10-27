import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stops register() at the exit, the way a real exit would.
class Exited extends Error {}

function mockEnv(checks: { config?: () => void; rpc?: () => Promise<void> }) {
  vi.doMock("@/server/env", () => ({
    assertProductionConfig: checks.config ?? (() => {}),
    assertSolanaRpcCluster: checks.rpc ?? (async () => {}),
  }));
}

async function register() {
  vi.resetModules();
  const instrumentation = await import("@/instrumentation");
  return instrumentation.register();
}

let exit: ReturnType<typeof vi.spyOn>;
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Exited();
  });
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock("@/server/env");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("exits in production when the config is incomplete, instead of serving 500s", async () => {
    mockEnv({
      config: () => {
        throw new Error("Refusing to start in production: missing CRON_SECRET.");
      },
    });
    await expect(register()).rejects.toBeInstanceOf(Exited);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logged).toHaveBeenCalledWith("Refusing to start in production: missing CRON_SECRET.");
  });

  it("exits in production when an RPC is on the wrong cluster", async () => {
    mockEnv({
      rpc: async () => {
        throw new Error("Refusing to start in production: SOLANA_RPC_URL is not a mainnet RPC.");
      },
    });
    await expect(register()).rejects.toBeInstanceOf(Exited);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits when the env module itself refuses to load", async () => {
    vi.stubEnv("SOLANA_CLUSTER", "mainnet-beta");
    await expect(register()).rejects.toBeInstanceOf(Exited);
    expect(logged).toHaveBeenCalledWith('SOLANA_CLUSTER must be "mainnet" or "devnet", not "mainnet-beta".');
  });

  it("boots when every check passes", async () => {
    const rpc = vi.fn(async () => {});
    mockEnv({ rpc });
    await expect(register()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("throws instead of exiting outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mockEnv({
      config: () => {
        throw new Error("bad");
      },
    });
    await expect(register()).rejects.toThrow("bad");
    expect(exit).not.toHaveBeenCalled();
  });

  it("does nothing in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const config = vi.fn();
    mockEnv({ config });
    await register();
    expect(config).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
