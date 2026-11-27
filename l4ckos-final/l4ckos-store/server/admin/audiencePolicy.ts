function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

/** Marketing requires a recorded waitlist opt-in and is blocked after unsubscribe. */
export function filterEligibleMarketingEmails(
  candidates: readonly unknown[],
  optedInEmails: Iterable<unknown>,
  unsubscribedEmails: Iterable<unknown>,
) {
  const optedIn = new Set([...optedInEmails].map(normalizeEmail).filter(Boolean));
  const suppressed = new Set([...unsubscribedEmails].map(normalizeEmail).filter(Boolean));
  return [...new Set(candidates.map(normalizeEmail).filter(Boolean))]
    .filter(email => optedIn.has(email) && !suppressed.has(email));
}
