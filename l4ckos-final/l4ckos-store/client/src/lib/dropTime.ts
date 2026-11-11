/** Formats an instant in the DROP's own timezone (never the browser's), so "abre às 09:00" means the same for everyone. */
export function formatDropInstant(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

function offsetMinutes(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utc.getTime() / 1000) * 1000) / 60000);
}

/**
 * Converts a `datetime-local` value ("2026-11-30T12:00") typed for a given IANA zone into an ISO-8601 string with an
 * explicit offset ("2026-11-30T12:00:00-03:00"), which the server requires. Returns "" for an empty/invalid input.
 */
export function zonedLocalToIso(local: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return "";
  const [, y, mo, d, h, mi] = match.map(Number) as unknown as number[];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle zones whose offset changes near the instant (DST).
  let offset = offsetMinutes(new Date(guess), timeZone);
  offset = offsetMinutes(new Date(guess - offset * 60000), timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${sign}${hh}:${mm}`;
}

/** Inverse of zonedLocalToIso for pre-filling edit forms. */
export function isoToZonedLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
