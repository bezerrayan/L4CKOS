import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  readSandboxNoopEvidence,
  HOOK,
  PAYMENT13,
} from "./asaasHoldNoopEvidence";
import { parseNoopArguments } from "./asaasHoldNoopCli";
import { NOOP_SCOPE } from "./asaasHoldNoop";
const events = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_REFUND_DENIED",
];
let replies: any[];
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("ASAAS_API_URL", "https://api-sandbox.asaas.com/v3");
  vi.stubEnv("ASAAS_API_KEY", "synthetic-local-key");
  replies = [
    {
      id: PAYMENT13,
      externalReference: "13",
      billingType: "PIX",
      status: "RECEIVED",
      value: 99,
      netValue: 98.01,
      deleted: false,
      refunds: null,
      chargeback: null,
    },
    { offset: 0, limit: 100, totalCount: 0, hasMore: false, data: null },
    {
      id: HOOK,
      url: "https://api-staging.l4ckos.com.br/api/webhooks/asaas",
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      sendType: "SEQUENTIALLY",
      events,
    },
  ];
  fetcher = vi.fn(
    async () => new Response(JSON.stringify(replies.shift()), { status: 200 })
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("fixed Sandbox proof and safe CLI", () => {
  it("GET-only proof uses fixed URLs, drops PII and supports the known null-zero refund shape", async () => {
    replies[0].customer = "not-in-evidence";
    const p = await readSandboxNoopEvidence();
    expect(p.facts.grossCents).toBe(9900);
    expect(JSON.stringify(p)).not.toContain("not-in-evidence");
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, opt] of fetcher.mock.calls as any) {
      expect(url).toMatch(/^https:\/\/api-sandbox\.asaas\.com\/v3\//);
      expect(opt.method).toBe("GET");
      expect(opt.redirect).toBe("error");
    }
  });
  it.each([
    "refund",
    "chargeback",
    "deleted",
    "amount",
    "reference",
    "status",
    "subscriptions",
    "paused",
    "malformedRefunds",
  ])("rejects %s proof", async kind => {
    if (kind === "refund") replies[1].totalCount = 1;
    if (kind === "chargeback") replies[0].chargeback = { status: "REQUESTED" };
    if (kind === "deleted") replies[0].deleted = true;
    if (kind === "amount") replies[0].netValue = 98;
    if (kind === "reference") replies[0].externalReference = "14";
    if (kind === "status") replies[0].status = "REFUNDED";
    if (kind === "subscriptions")
      replies[2].events = [...events, "PAYMENT_FUTURE_UNKNOWN"];
    if (kind === "paused") replies[2].interrupted = true;
    if (kind === "malformedRefunds") delete replies[1].totalCount;
    await expect(readSandboxNoopEvidence()).rejects.toThrow();
  });
  it("rejects production URL before any network call", async () => {
    vi.stubEnv("ASAAS_API_URL", "https://api.asaas.com/v3");
    await expect(readSandboxNoopEvidence()).rejects.toThrow(
      "NOOP_SANDBOX_REQUIRED"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects HTTP error without emitting provider response", async () => {
    fetcher.mockImplementationOnce(
      async () =>
        new Response("synthetic sensitive provider body", { status: 503 })
    );
    await expect(readSandboxNoopEvidence()).rejects.toThrow(
      "NOOP_PROVIDER_READ_FAILED"
    );
  });
  it("CLI defaults to dry-run and requires session via stdin", () => {
    expect(
      parseNoopArguments(["--request", "fixture.json", "--session-stdin"]).apply
    ).toBe(false);
    expect(() =>
      parseNoopArguments([
        "--request",
        "fixture.json",
        "--token",
        "visible-secret",
      ])
    ).toThrow("NOOP_ARGUMENTS");
    expect(() =>
      parseNoopArguments(["--request", "fixture.json", "--actor", "14"])
    ).toThrow("NOOP_ARGUMENTS");
  });
  it("apply requires exact hold IDs, event IDs and the reviewed digest", () => {
    const args = ["--request", "fixture.json", "--session-stdin", "--apply"];
    expect(() => parseNoopArguments(args)).toThrow(
      "NOOP_EXPLICIT_IDS_AND_DIGEST_REQUIRED"
    );
    expect(
      parseNoopArguments([
        ...args,
        "--confirm-holds",
        "74,76",
        "--confirm-events",
        NOOP_SCOPE.map(x => x.eventId).join(","),
        "--expected-digest",
        "a".repeat(64),
      ]).apply
    ).toBe(true);
    expect(() =>
      parseNoopArguments([
        ...args,
        "--confirm-holds",
        "74,78",
        "--confirm-events",
        "other",
        "--expected-digest",
        "a".repeat(64),
      ])
    ).toThrow();
  });
});
