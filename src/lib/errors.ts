/** An error whose message is safe and useful to show to the Discord user as-is. */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}

const GENERIC_MESSAGE = "Something went wrong on my side. Please try again in a moment.";

/** Message to show the user for any thrown value; internal details are never leaked. */
export function userMessage(err: unknown): string {
  return err instanceof UserFacingError ? err.message : GENERIC_MESSAGE;
}
