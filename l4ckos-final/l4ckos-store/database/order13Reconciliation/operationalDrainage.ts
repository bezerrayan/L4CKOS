/** Operational classification only: no connection, SQL, dispatch or financial gate override. */
export const ORDER13_DRAINAGE_WINDOW = Object.freeze({
  id: "order13-a75f3a82-20261017T053400Z",
  orderId: 13,
  validUntil: "2026-10-17T05:49:00.000Z",
  deployment: "a75f3a82-3b4e-4c25-bf2d-de5cc358eaf6",
  bundleHash:
    "bddfa32b7a24b2aaa71c405143b499329212fa3e7c6001749b067aa8d4f7f457",
  databaseUuidHash:
    "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09",
  externalEmailOutcome: "UNKNOWN",
  claims: Object.freeze([
    Object.freeze({
      id: 1,
      orderId: 6,
      rowHash:
        "8538649a3a892f2e85822f7cd0b5157962eaa99ce9f78d5b4eb32ccb8d41769a",
    }),
    Object.freeze({
      id: 2,
      orderId: 6,
      rowHash:
        "7cfc9e0a0c8ca1e53d815cb2e177e790db156e5f139d4645967a214509a1b50e",
    }),
  ]),
});
type Claim = { id: number; orderId: number; status: string; rowHash: string };
/** Other writers, queues, transactions, provider IO and both original gates remain mandatory. */
export function classifyOrder13HistoricalClaims(
  input: {
    windowId: string;
    orderId: number;
    deployment: string;
    bundleHash: string;
    databaseUuidHash: string;
    maintenance: boolean;
    observedAt: string;
    expiresAt: string;
    claims: Claim[];
  },
  now = Date.now()
) {
  const w = ORDER13_DRAINAGE_WINDOW;
  const age = now - Date.parse(input.observedAt),
    remaining = Date.parse(input.expiresAt) - now;
  if (
    input.windowId !== w.id ||
    input.orderId !== w.orderId ||
    input.deployment !== w.deployment ||
    input.bundleHash !== w.bundleHash ||
    input.databaseUuidHash !== w.databaseUuidHash ||
    input.maintenance !== true ||
    !Number.isFinite(age) ||
    age < -5000 ||
    age > 120000 ||
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > 900000 ||
    Date.parse(input.expiresAt) > Date.parse(w.validUntil) ||
    now >= Date.parse(w.validUntil)
  )
    throw Error("DRAINAGE_EXCEPTION_SCOPE_INVALID");
  for (const expected of w.claims) {
    const rows = input.claims.filter(r => r.id === expected.id);
    if (
      rows.length !== 1 ||
      rows[0].orderId !== expected.orderId ||
      rows[0].status !== "processing" ||
      rows[0].rowHash !== expected.rowHash
    )
      throw Error("DRAINAGE_EXCEPTION_CLAIM_CHANGED");
  }
  return {
    excludedHistoricalIds: [1, 2],
    remainingProcessing: input.claims.filter(
      r => r.status === "processing" && !w.claims.some(e => e.id === r.id)
    ),
    externalEmailOutcome: "UNKNOWN",
    recordsModified: 0,
  };
}
