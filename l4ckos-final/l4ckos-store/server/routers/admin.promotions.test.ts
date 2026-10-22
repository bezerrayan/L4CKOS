import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getPromoBanners: vi.fn(),
  getHomeHighlightSettings: vi.fn(),
  updateHomeHighlightSettings: vi.fn(),
  getPublicHomeHighlights: vi.fn(),
  createPromoBanner: vi.fn(),
  updatePromoBanner: vi.fn(),
  deletePromoBanner: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...await importOriginal<typeof import("../db")>(),
  getPromoBanners: dbMocks.getPromoBanners,
  getHomeHighlightSettings: dbMocks.getHomeHighlightSettings,
  updateHomeHighlightSettings: dbMocks.updateHomeHighlightSettings,
  getPublicHomeHighlights: dbMocks.getPublicHomeHighlights,
  createPromoBanner: dbMocks.createPromoBanner,
  updatePromoBanner: dbMocks.updatePromoBanner,
  deletePromoBanner: dbMocks.deletePromoBanner,
  createAuditLog: dbMocks.createAuditLog,
}));

const adminUser = { id: 91, openId: "highlight-admin", email: "admin@local.dev", role: "admin" };
const regularUser = { id: 92, openId: "highlight-user", email: "user@example.invalid", role: "user" };

async function caller(user: typeof adminUser | typeof regularUser | null) {
  const { adminRouter } = await import("./admin");
  return adminRouter.createCaller({ user, req: {} as any, res: {} as any } as any);
}

const validCreate = {
  badge: "DESTAQUE",
  title: "Campanha local",
  description: "Texto demonstrativo para teste local.",
  ctaLabel: "Ver produto",
  imageUrl: "/uploads/campaign.webp",
  mobileImageUrl: "",
  imageAlt: "Fotografia da campanha",
  linkUrl: "/produtos",
  discountText: "",
  discountLabel: "OFF",
  bgStyle: "#000000",
  sortOrder: 0,
  isActive: true,
};

describe("admin home highlight routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the existing authenticated create/update/delete and list contracts", async () => {
    dbMocks.getPromoBanners.mockResolvedValue([{ id: 8, ...validCreate }]);
    dbMocks.createPromoBanner.mockResolvedValue([{ insertId: 8 }]);
    dbMocks.updatePromoBanner.mockResolvedValue(undefined);
    dbMocks.deletePromoBanner.mockResolvedValue(undefined);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    const admin = await caller(adminUser);

    await expect(admin.promoBannersList()).resolves.toHaveLength(1);
    await expect(admin.promoBannerCreate(validCreate)).resolves.toEqual({ success: true });
    await expect(admin.promoBannerUpdate({ id: 8, sortOrder: -1 })).resolves.toEqual({ success: true });
    await expect(admin.promoBannerUpdate({ id: 8, isActive: false })).resolves.toEqual({ success: true });
    await expect(admin.promoBannerDelete({ id: 8 })).resolves.toEqual({ success: true });

    expect(dbMocks.getPromoBanners).toHaveBeenCalledWith();
    expect(dbMocks.createPromoBanner).toHaveBeenCalledWith(expect.objectContaining({ title: "Campanha local" }));
    expect(dbMocks.updatePromoBanner).toHaveBeenCalledTimes(2);
    expect(dbMocks.deletePromoBanner).toHaveBeenCalledWith(8);
    expect(dbMocks.createAuditLog).toHaveBeenCalledTimes(4);
  });

  it("rejects executable or credential-bearing destinations before persistence", async () => {
    const admin = await caller(adminUser);
    await expect(admin.promoBannerCreate({ ...validCreate, linkUrl: "javascript:alert(1)" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.promoBannerCreate({ ...validCreate, imageUrl: "data:image/svg+xml,<svg/>" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.promoBannerCreate({ ...validCreate, linkUrl: "https://user:secret@example.test/" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.promoBannerUpdate({ id: 8, linkUrl: "//external.example.test/path" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.createPromoBanner).not.toHaveBeenCalled();
    expect(dbMocks.updatePromoBanner).not.toHaveBeenCalled();
  });

  it("preserves server-side admin authorization", async () => {
    await expect((await caller(regularUser)).promoBannersList()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await caller(regularUser)).promoBannerUpdate({ id: 8, isActive: false }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.getPromoBanners).not.toHaveBeenCalled();
    expect(dbMocks.updatePromoBanner).not.toHaveBeenCalled();
  });

  it("keeps the public promotions query limited to active records", async () => {
    dbMocks.getPromoBanners.mockResolvedValue([{ id: 8, ...validCreate }]);
    const { productsRouter } = await import("./products");
    const publicCaller = productsRouter.createCaller({} as any);
    await expect(publicCaller.promotions()).resolves.toHaveLength(1);
    expect(dbMocks.getPromoBanners).toHaveBeenCalledWith({ activeOnly: true });
  });

  it("reads and updates only the persisted singleton through the admin contract", async () => {
    const settings = { id: 1, displayMode: "rotate" as const, rotationIntervalSeconds: 8, updatedAt: new Date("2026-10-21T12:00:00Z") };
    dbMocks.getHomeHighlightSettings.mockResolvedValue(settings);
    dbMocks.updateHomeHighlightSettings.mockResolvedValue(settings);
    dbMocks.createAuditLog.mockResolvedValue(undefined);
    const admin = await caller(adminUser);

    await expect(admin.homeHighlightSettingsGet()).resolves.toMatchObject({ id: 1, displayMode: "rotate", rotationIntervalSeconds: 8 });
    await expect(admin.homeHighlightSettingsUpdate({ displayMode: "rotate", rotationIntervalSeconds: 8 }))
      .resolves.toMatchObject({ id: 1, displayMode: "rotate", rotationIntervalSeconds: 8 });
    expect(dbMocks.updateHomeHighlightSettings).toHaveBeenCalledWith({ displayMode: "rotate", rotationIntervalSeconds: 8 });
    expect(dbMocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: adminUser.id,
      action: "homeHighlights.settings.update",
      entityId: "1",
    }));
  });

  it("rejects invalid mode and interval before persistence", async () => {
    const admin = await caller(adminUser);
    await expect((admin as any).homeHighlightSettingsUpdate({ displayMode: "carousel", rotationIntervalSeconds: 7 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect((admin as any).homeHighlightSettingsUpdate({ displayMode: "single", rotationIntervalSeconds: 4 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.updateHomeHighlightSettings).not.toHaveBeenCalled();
  });

  it("keeps settings read and write protected by adminProcedure", async () => {
    const regular = await caller(regularUser);
    await expect(regular.homeHighlightSettingsGet()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(regular.homeHighlightSettingsUpdate({ displayMode: "single", rotationIntervalSeconds: 8 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.getHomeHighlightSettings).not.toHaveBeenCalled();
    expect(dbMocks.updateHomeHighlightSettings).not.toHaveBeenCalled();
  });

  it("makes an unapplied settings migration explicit in the administrative UI contract", async () => {
    dbMocks.getHomeHighlightSettings.mockResolvedValue(null);
    const admin = await caller(adminUser);
    await expect(admin.homeHighlightSettingsGet()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dbMocks.getHomeHighlightSettings).toHaveBeenCalledOnce();
  });

  it("returns only public active campaign presentation data with safe fallback settings", async () => {
    dbMocks.getPublicHomeHighlights.mockResolvedValue({
      displayMode: "single",
      rotationIntervalSeconds: 8,
      campaigns: [{ id: 8, title: "Campanha ativa", isActive: true }],
    });
    const { productsRouter } = await import("./products");
    const publicCaller = productsRouter.createCaller({} as any);
    await expect(publicCaller.homeHighlights()).resolves.toEqual({
      displayMode: "single",
      rotationIntervalSeconds: 8,
      campaigns: [{ id: 8, title: "Campanha ativa", isActive: true }],
    });
    expect(dbMocks.getPublicHomeHighlights).toHaveBeenCalledOnce();
  });
});
