import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getAdminAudienceSummary: vi.fn(),
  getAdminAudiencePage: vi.fn(),
  getAdminAudienceCsvRows: vi.fn(),
  getMarketingAudienceEmails: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getAdminAudienceSummary: dbMocks.getAdminAudienceSummary,
  getAdminAudiencePage: dbMocks.getAdminAudiencePage,
  getAdminAudienceCsvRows: dbMocks.getAdminAudienceCsvRows,
  getMarketingAudienceEmails: dbMocks.getMarketingAudienceEmails,
  createAuditLog: dbMocks.createAuditLog,
}));

const adminUser = { id: 41, openId: "audience-admin", email: "admin@local.dev", role: "admin" };
const regularUser = { id: 42, openId: "audience-user", email: "customer@example.invalid", role: "user" };

async function caller(user: typeof adminUser | typeof regularUser | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

describe("admin audience routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getAdminAudienceSummary.mockResolvedValue({ waitlistTotal: 4, customersTotal: 3, newToday: 1, newLast7Days: 2 });
    dbMocks.getAdminAudiencePage.mockResolvedValue({ rows: [], total: 0 });
    dbMocks.getAdminAudienceCsvRows.mockResolvedValue([]);
    dbMocks.getMarketingAudienceEmails.mockResolvedValue([]);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
  });

  it.each([null, regularUser])("denies all audience data routes to non-admin callers", async user => {
    const api = await caller(user);
    const code = user ? "FORBIDDEN" : "UNAUTHORIZED";
    await expect(api.publicAudienceSummary()).rejects.toMatchObject({ code });
    await expect(api.publicAudienceList({ source: "waitlist" })).rejects.toMatchObject({ code });
    await expect(api.publicAudienceCsv({ source: "customers" })).rejects.toMatchObject({ code });
    await expect(api.marketingAudiencePreview({ audience: "both" })).rejects.toMatchObject({ code });
    await expect(api.marketingCampaignSend({ campaign: "drop", audience: "both" })).rejects.toMatchObject({ code });
    expect(dbMocks.getAdminAudienceSummary).not.toHaveBeenCalled();
    expect(dbMocks.getAdminAudiencePage).not.toHaveBeenCalled();
    expect(dbMocks.getAdminAudienceCsvRows).not.toHaveBeenCalled();
    expect(dbMocks.getMarketingAudienceEmails).not.toHaveBeenCalled();
  });

  it("returns the summary and applies trimmed search and bounded pagination on the server", async () => {
    const api = await caller(adminUser);
    const row = {
      id: 3,
      name: "Cliente de teste",
      email: "client@example.invalid",
      createdAt: new Date("2026-11-20T12:00:00.000Z"),
      eligibleForMarketing: false,
      phone: "+5500000000000",
      cpf: "00000000000",
    };
    dbMocks.getAdminAudiencePage.mockResolvedValue({ rows: [row], total: 26 });

    await expect(api.publicAudienceSummary()).resolves.toEqual({ waitlistTotal: 4, customersTotal: 3, newToday: 1, newLast7Days: 2 });
    await expect(api.publicAudienceList({ source: "customers", search: "  Client@  ", page: 2, pageSize: 25 })).resolves.toEqual({
      total: 26,
      rows: [{ id: 3, name: "Cliente de teste", email: "client@example.invalid", createdAt: row.createdAt, eligibleForMarketing: false }],
    });
    expect(dbMocks.getAdminAudiencePage).toHaveBeenCalledWith({ source: "customers", search: "Client@", page: 2, pageSize: 25 });
    await expect(api.publicAudienceList({ source: "customers", pageSize: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("exports only the selected columns, protects CSV formulas, and audits without query PII", async () => {
    dbMocks.getAdminAudienceCsvRows.mockResolvedValue([{
      name: "=HYPERLINK(\"https://example.invalid\")",
      email: "+formula@example.invalid",
      createdAt: new Date("2026-11-20T12:00:00.000Z"),
    }]);
    const result = await (await caller(adminUser)).publicAudienceCsv({ source: "customers", search: "person@example.invalid" });

    expect(result.csv.split("\r\n")[0]).toBe("name,email,createdAt");
    expect(result.csv).toContain("'=HYPERLINK(");
    expect(result.csv).toContain("'+formula@example.invalid");
    expect(result.csv).toContain("2026-11-20T12:00:00.000Z");
    expect(result.csv).not.toContain("phone");
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: adminUser.id,
      action: "audience.export.csv",
      metadata: { source: "customers", rows: 1, searchUsed: true },
    }));
    expect(JSON.stringify(dbMocks.createAuditLog.mock.calls)).not.toContain("person@example.invalid");
  });

  it("previews selected recipient IDs with a count only", async () => {
    dbMocks.getMarketingAudienceEmails.mockResolvedValue(["one@example.invalid", "two@example.invalid"]);
    await expect((await caller(adminUser)).marketingAudiencePreview({
      audience: "selected",
      selectedRecipients: [{ source: "waitlist", id: 7 }, { source: "customers", id: 3 }],
    })).resolves.toEqual({ count: 2 });
    expect(dbMocks.getMarketingAudienceEmails).toHaveBeenCalledWith({
      audience: "selected",
      selectedRecipients: [{ source: "waitlist", id: 7 }, { source: "customers", id: 3 }],
    });
  });
});
