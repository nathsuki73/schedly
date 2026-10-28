import { MANAGE_EVENTS } from "../commands/definitions.ts";
import type { GuildMember } from "./types.ts";

export const ADMINISTRATOR = 1n << 3n;
export { MANAGE_EVENTS };

export function hasPermission(member: GuildMember | undefined, permission: bigint): boolean {
  if (!member?.permissions) return false;
  try {
    const perms = BigInt(member.permissions);
    return (perms & ADMINISTRATOR) !== 0n || (perms & permission) === permission;
  } catch {
    return false;
  }
}
