import { it, expect } from "vitest";
import {
  ORDER13_DRAINAGE_WINDOW as w,
  classifyOrder13HistoricalClaims as classify,
} from "../../database/order13Reconciliation/operationalDrainage";
const now = Date.parse(w.validUntil) - 700000;
const input = () => ({
  windowId: w.id,
  orderId: 13,
  deployment: w.deployment,
  bundleHash: w.bundleHash,
  databaseUuidHash: w.databaseUuidHash,
  maintenance: true,
  observedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 600000).toISOString(),
  claims: w.claims.map(c => ({ ...c, status: "processing" })),
});
it("classifies only the two immutable historical rows without changing them", () => {
  const v = input(),
    before = JSON.stringify(v);
  expect(classify(v, now)).toEqual({
    excludedHistoricalIds: [1, 2],
    remainingProcessing: [],
    externalEmailOutcome: "UNKNOWN",
    recordsModified: 0,
  });
  expect(JSON.stringify(v)).toBe(before);
});
it("a changed hash, owner, state or missing row rejects the exception", () => {
  for (const change of ["hash", "owner", "state", "missing"]) {
    const v = input();
    if (change === "hash") v.claims[0].rowHash = "0".repeat(64);
    if (change === "owner") v.claims[0].orderId = 13;
    if (change === "state") v.claims[0].status = "sent";
    if (change === "missing") v.claims.pop();
    expect(() => classify(v, now)).toThrow("CLAIM_CHANGED");
  }
});
it("another processing claim is still a blocker, including an order13 claim", () => {
  const v = input();
  v.claims.push({
    id: 3,
    orderId: 13,
    rowHash: "a".repeat(64),
    status: "processing",
  });
  expect(classify(v, now).remainingProcessing.map(r => r.id)).toEqual([3]);
});
it("different window, deployment or disabled maintenance cannot reuse the exception", () => {
  for (const change of ["window", "deploy", "maintenance"]) {
    const v = input();
    if (change === "window") v.windowId = "other";
    if (change === "deploy") v.deployment = "other";
    if (change === "maintenance") v.maintenance = false;
    expect(() => classify(v, now)).toThrow("SCOPE_INVALID");
  }
});
it("expired window and stale observation fail closed", () => {
  const v = input();
  v.expiresAt = new Date(now).toISOString();
  expect(() => classify(v, now)).toThrow();
  const extension = input();
  extension.expiresAt = new Date(Date.parse(w.validUntil) + 1000).toISOString();
  expect(() => classify(extension, now)).toThrow();
  const s = input();
  s.observedAt = new Date(now - 120001).toISOString();
  expect(() => classify(s, now)).toThrow();
});
