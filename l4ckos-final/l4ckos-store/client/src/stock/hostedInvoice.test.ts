import { describe, expect, it } from "vitest";
import { isTrustedHostedInvoiceUrl } from "./hostedInvoice";

describe("isTrustedHostedInvoiceUrl", () => {
  it("production accepts only the exact Asaas production host over https", () => {
    expect(isTrustedHostedInvoiceUrl("https://www.asaas.com/i/abc123", "production")).toBe(true);
    for (const bad of [
      "https://sandbox.asaas.com/i/abc",
      "http://www.asaas.com/i/abc",
      "https://www.asaas.com.evil.example/i/abc",
      "https://evil.example/?u=https://www.asaas.com/i/abc",
      "https://user:pass@www.asaas.com/i/abc",
      "https://www.asaas.com:8443/i/abc",
      "javascript:alert(1)",
      "//www.asaas.com/i/abc",
      "",
      null,
      undefined,
      42,
    ]) expect(isTrustedHostedInvoiceUrl(bad, "production"), String(bad)).toBe(false);
  });

  it("non-production builds accept only the Asaas sandbox host", () => {
    expect(isTrustedHostedInvoiceUrl("https://sandbox.asaas.com/i/abc123", "staging")).toBe(true);
    expect(isTrustedHostedInvoiceUrl("https://sandbox.asaas.com/i/abc123", undefined)).toBe(true);
    expect(isTrustedHostedInvoiceUrl("https://www.asaas.com/i/abc123", "staging")).toBe(false);
  });
});
