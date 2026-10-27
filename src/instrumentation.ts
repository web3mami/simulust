// When register() throws, Next logs it and keeps listening, answering every
// request with a 500 while a port health check passes. A production server with
// a bad config exits instead, so the deploy crash-loops and never goes live.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { assertProductionConfig, assertSolanaRpcCluster } = await import("@/server/env");
      assertProductionConfig();
      await assertSolanaRpcCluster();
    } catch (error) {
      if (process.env.NODE_ENV !== "production") throw error;
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
