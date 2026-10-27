// Shared by the checkout and the Solana Pay transaction route. A blockhash
// lives for about a minute, so no payment is started in the last minute of a
// price hold: it could land after the checkout closes.
export const MIN_REMAINING_MS = 60_000;
