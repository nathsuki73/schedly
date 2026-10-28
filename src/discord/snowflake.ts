const DISCORD_EPOCH = 1420070400000n;

/** Milliseconds since the Unix epoch encoded in a Discord snowflake ID. */
export function snowflakeTimestamp(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}
