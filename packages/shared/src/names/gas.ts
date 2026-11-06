// Gas limits every sender of our calls shares (the relayer, the Box's admin, a site's wallet).

/**
 * The limit for a call that creates a resolver or a registry (`addGame`, `Championships.open` and `close`, a claim):
 * `eth_estimateGas` comes out too low for nested calls that create storage, and a limit above 2^24 holds the excess as
 * a reservoir for state gas.
 */
export const CREATES_STORAGE_GAS = (1n << 24n) + 4_000_000n;
