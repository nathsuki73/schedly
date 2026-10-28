/**
 * Identity of an event for duplicate detection: the same title at the same start time is the same
 * event, even when it comes from a different screenshot. Lowercased, whitespace-collapsed.
 */
export function eventKey(title: string, startTimeIso: string): string {
  return `${title.trim().replace(/\s+/g, " ").toLowerCase()}|${startTimeIso}`;
}
