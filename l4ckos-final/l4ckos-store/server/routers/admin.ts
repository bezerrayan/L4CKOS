import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  createAuditLog,
  createCoupon,
  createProduct,
  deleteProduct,
  deleteCoupon,
  getCartItems,
  getAuditLogs,
  getBackupPayload,
  getCoupons,
  getPromoBanners,
  createPromoBanner,
  updatePromoBanner,
  deletePromoBanner,
  getDashboardKpis,
  getAllOrders,
  getAllWaitlistEmails,
  getOrderById,
  getProductsByIds,
  getUserById,
  getOrdersByFilters,
  getProductsAdmin,
  getAdminProductReviews,
  getSalesByPeriod,
  getUsersWithStats,
  replaceProductImages,
  replaceProductVariants,
  restoreBackupPayload,
  setOrderAdminData,
  setUserFlags,
  moderateProductReview,
  updateProduct,
  updateCoupon,
  updateUserRole,
} from "../db";
import { reviewModerationInputSchema } from "../reviews/policy";
import { ENV } from "../_core/env";
import { TRPCError } from "@trpc/server";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  sendAbandonedCartReminder1Email,
  sendAbandonedCartReminder2Email,
  sendAbandonedCartReminder3Email,
  sendCrossSellEmail,
  sendLoyaltyCouponEmail,
  sendNewDropAnnouncementEmail,
  sendNewProductsAnnouncementEmail,
  sendOrderDeliveredEmail,
  sendOrderPreparingEmail,
  sendPaymentNotFinishedEmail,
  sendPromotionEmail,
  sendReviewRequestEmail,
  sendShippingEmail,
  sendWaitlistLaunchEmail,
} from "../services/emailService.js";
import { formatCurrency } from "../utils/email/formatCurrency.js";

const orderStatusSchema = z.enum([
  "pending",
  "processing",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
]);
const backupFileNameSchema = z.string().trim().regex(/^[A-Za-z0-9._-]+\.json$/);
const productImageUrlSchema = z.string().trim().max(500, "A URL da imagem deve ter no máximo 500 caracteres.");

type ProductImageInput = {
  imageUrl: string;
  imageThumbnailUrl?: string | null;
  imageDetailUrl?: string | null;
  imageBannerUrl?: string | null;
  color?: string | null;
  alt?: string | null;
};

export function buildProductImageList(
  cover: Omit<ProductImageInput, "imageUrl"> & { imageUrl?: string | null },
  gallery: ProductImageInput[],
) {
  const coverImage = cover.imageUrl
    ? [{
        imageUrl: cover.imageUrl,
        imageThumbnailUrl: cover.imageThumbnailUrl ?? null,
        imageDetailUrl: cover.imageDetailUrl ?? null,
        imageBannerUrl: cover.imageBannerUrl ?? null,
        color: null,
      }]
    : [];

  return [...coverImage, ...gallery].filter(
    (image, index, images) => images.findIndex(candidate => candidate.imageUrl === image.imageUrl) === index,
  );
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(",");
}

function sanitizeRecipientList(emails: string[]) {
  return [...new Set(emails.map(item => String(item ?? "").trim().toLowerCase()).filter(Boolean))];
}

async function getAudienceEmails(audience: "waitlist" | "allUsers" | "vipUsers" | "custom", customEmails: string[] = []) {
  if (audience === "custom") {
    return sanitizeRecipientList(customEmails);
  }

  if (audience === "waitlist") {
    const waitlist = await getAllWaitlistEmails();
    return sanitizeRecipientList(waitlist.map(item => item.email));
  }

  const users = await getUsersWithStats();
  const filtered = audience === "vipUsers" ? users.filter(user => Boolean(user.isVip)) : users;
  return sanitizeRecipientList(filtered.map(user => String(user.email ?? "")));
}

type SafeIntegrationStatus = "configured" | "partial" | "missing" | "environment";
type SafeIntegrationRuntime = {
  status: SafeIntegrationStatus;
  configuredCount: number;
  expectedCount: number;
};

function hasEnv(name: string) {
  return Boolean(String(process.env[name] ?? "").trim());
}

function resolveSafeIntegrationStatus(required: string[], optional: string[] = []): SafeIntegrationRuntime {
  const requiredConfigured = required.filter(hasEnv).length;
  const optionalConfigured = optional.filter(hasEnv).length;

  if (required.length > 0 && requiredConfigured === required.length) {
    return {
      status: "configured" as SafeIntegrationStatus,
      configuredCount: requiredConfigured + optionalConfigured,
      expectedCount: required.length + optional.length,
    };
  }

  if (requiredConfigured > 0 || optionalConfigured > 0) {
    return {
      status: "partial" as SafeIntegrationStatus,
      configuredCount: requiredConfigured + optionalConfigured,
      expectedCount: required.length + optional.length,
    };
  }

  return {
    status: "missing" as SafeIntegrationStatus,
    configuredCount: 0,
    expectedCount: required.length + optional.length,
  };
}

export const adminRouter = router({
  dashboard: adminProcedure.query(async () => {
    const [kpis, users, products, orders] = await Promise.all([
      getDashboardKpis(),
      getUsersWithStats(),
      getProductsAdmin(),
      getAllOrders(),
    ]);

    return {
      ...kpis,
      usersCount: users.length,
      productsCount: products.length,
      ordersCount: orders.length,
    };
  }),

  settingsStatus: adminProcedure.query(async () => {
    const frontendUrlConfigured = Boolean(
      String(ENV.frontendUrl || process.env.APP_URL || process.env.APP_BASE_URL || "").trim(),
    );

    return {
      mode: "read-only" as const,
      generatedAt: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV === "production" ? "production" : "non-production",
        frontendUrlConfigured,
        databaseConfigured: Boolean(ENV.databaseUrl),
      },
      integrations: {
        asaas: resolveSafeIntegrationStatus(["ASAAS_API_KEY"], ["ASAAS_API_URL", "ASAAS_CHECKOUT_BASE_URL", "ASAAS_WEBHOOK_TOKEN"]),
        melhorEnvio: resolveSafeIntegrationStatus(["MELHOR_ENVIO_TOKEN"], ["MELHOR_ENVIO_API_URL", "MELHOR_ENVIO_FROM_POSTAL_CODE"]),
        resend: resolveSafeIntegrationStatus(["RESEND_API_KEY"], [
          "EMAIL_FROM",
          "EMAIL_FROM_MARKETING",
          "EMAIL_FROM_NOREPLY",
          "NO_REPLY_EMAIL",
          "EMAIL_REPLY_TO",
        ]),
        googleOAuth: resolveSafeIntegrationStatus(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], ["GOOGLE_REDIRECT_URI"]),
        database: {
          status: ENV.databaseUrl ? "configured" : "missing",
          configuredCount: ENV.databaseUrl ? 1 : 0,
          expectedCount: 1,
        } satisfies SafeIntegrationRuntime,
        frontend: {
          status: frontendUrlConfigured ? "configured" : "environment",
          configuredCount: frontendUrlConfigured ? 1 : 0,
          expectedCount: 1,
        } satisfies SafeIntegrationRuntime,
      },
      security: {
        secretsExposed: false,
        editable: false,
        source: "server-environment-presence" as const,
      },
    };
  }),

  usersList: adminProcedure.query(async () => {
    const users = await getUsersWithStats();
    return users;
  }),

  userSetRole: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        role: z.enum(["user", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.role === "admin") {
        const targetUser = await getUserById(input.userId);
        const normalizedEmail = String(targetUser?.email ?? "").trim().toLowerCase();
        const allowedAdmin = Boolean(normalizedEmail) && ENV.adminEmails.includes(normalizedEmail);
        if (!allowedAdmin) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Este e-mail não pode receber permissão de admin.",
          });
        }
      }

      await updateUserRole(input.userId, input.role);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "user.setRole",
        entity: "user",
        entityId: String(input.userId),
        metadata: { role: input.role },
      });
      return { success: true } as const;
    }),

  userSetFlags: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        isVip: z.boolean().optional(),
        isBlocked: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setUserFlags(input.userId, {
        isVip: input.isVip,
        isBlocked: input.isBlocked,
      });
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "user.setFlags",
        entity: "user",
        entityId: String(input.userId),
        metadata: { isVip: input.isVip, isBlocked: input.isBlocked },
      });
      return { success: true } as const;
    }),

  productsList: adminProcedure.query(async () => {
    const products = await getProductsAdmin();
    return products;
  }),

  productCreate: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        category: z.string().min(1),
        price: z.number().positive(),
        description: z.string().optional(),
        fullDescription: z.string().optional(),
        imageUrl: productImageUrlSchema.optional(),
        imageThumbnailUrl: productImageUrlSchema.optional(),
        imageDetailUrl: productImageUrlSchema.optional(),
        imageBannerUrl: productImageUrlSchema.optional(),
        optionColors: z.array(z.string().min(1).max(60)).optional().default([]),
        optionSizes: z.array(z.string().min(1).max(60)).optional().default([]),
        sizeType: z.enum(["alpha", "numeric", "custom"]).optional().default("alpha"),
        stock: z.number().int().min(0).default(0),
        images: z.array(
          z.object({
            imageUrl: productImageUrlSchema,
            imageThumbnailUrl: productImageUrlSchema.nullable().optional(),
            imageDetailUrl: productImageUrlSchema.nullable().optional(),
            imageBannerUrl: productImageUrlSchema.nullable().optional(),
            color: z.string().trim().max(60).nullable().optional(),
          }),
        ).optional().default([]),
        variants: z
          .array(
            z.object({
              name: z.string().min(1),
              sku: z.string().optional().nullable(),
              price: z.number().optional().nullable(),
              stock: z.number().int().min(0),
            }),
          )
          .optional()
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { images, variants, optionColors, optionSizes, sizeType, ...rest } = input;
      const productData = {
        ...rest,
        optionColors: optionColors.length > 0 ? JSON.stringify(optionColors) : null,
        optionSizes: optionSizes.length > 0 ? JSON.stringify(optionSizes) : null,
        sizeType,
      };
      const result = await createProduct(productData);
      const insertedId = Number((result as any)?.[0]?.insertId ?? 0);
      if (insertedId > 0) {
        const allImages = buildProductImageList(productData, images);
        try {
          await replaceProductImages(insertedId, allImages);
        } catch (error) {
          console.error("[admin.productCreate] image sync failed", {
            productId: insertedId,
            reason: error instanceof Error ? error.message : String(error),
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "O produto foi criado, mas as fotos adicionais não puderam ser salvas. Abra-o para editar e tente enviar as fotos novamente.",
          });
        }
        try {
          await replaceProductVariants(insertedId, variants);
        } catch (error) {
          console.warn("[admin.productCreate] optional variant sync failed", {
            productId: insertedId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "product.create",
        entity: "product",
        entityId: String(insertedId || "new"),
        metadata: { name: productData.name, category: productData.category },
      });
      return { success: true } as const;
    }),

  productUpdate: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().optional(),
        category: z.string().optional(),
        price: z.number().positive().optional(),
        description: z.string().optional(),
        fullDescription: z.string().optional(),
        imageUrl: productImageUrlSchema.optional(),
        imageThumbnailUrl: productImageUrlSchema.optional(),
        imageDetailUrl: productImageUrlSchema.optional(),
        imageBannerUrl: productImageUrlSchema.optional(),
        optionColors: z.array(z.string().min(1).max(60)).optional(),
        optionSizes: z.array(z.string().min(1).max(60)).optional(),
        sizeType: z.enum(["alpha", "numeric", "custom"]).optional(),
        stock: z.number().int().min(0).optional(),
        images: z.array(
          z.object({
            imageUrl: productImageUrlSchema,
            imageThumbnailUrl: productImageUrlSchema.nullable().optional(),
            imageDetailUrl: productImageUrlSchema.nullable().optional(),
            imageBannerUrl: productImageUrlSchema.nullable().optional(),
            color: z.string().trim().max(60).nullable().optional(),
          }),
        ).optional(),
        variants: z
          .array(
            z.object({
              name: z.string().min(1),
              sku: z.string().optional().nullable(),
              price: z.number().optional().nullable(),
              stock: z.number().int().min(0),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, images, variants, optionColors, optionSizes, sizeType, ...rest } = input;
      const data = {
        ...rest,
        ...(optionColors !== undefined
          ? { optionColors: optionColors.length > 0 ? JSON.stringify(optionColors) : null }
          : {}),
        ...(optionSizes !== undefined
          ? { optionSizes: optionSizes.length > 0 ? JSON.stringify(optionSizes) : null }
          : {}),
        ...(sizeType !== undefined ? { sizeType } : {}),
      };
      await updateProduct(id, data);
      if (images) {
        try {
          await replaceProductImages(id, buildProductImageList(data, images));
        } catch (error) {
          console.error("[admin.productUpdate] image sync failed", {
            productId: id,
            reason: error instanceof Error ? error.message : String(error),
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "As alterações do produto foram salvas, mas as fotos adicionais não puderam ser gravadas. Tente novamente.",
          });
        }
      }
      if (variants) {
        try {
          await replaceProductVariants(id, variants);
        } catch (error) {
          console.warn("[admin.productUpdate] optional variant sync failed", {
            productId: id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "product.update",
        entity: "product",
        entityId: String(id),
        metadata: data,
      });
      return { success: true } as const;
    }),

  productDelete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await deleteProduct(input.id);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "product.delete",
        entity: "product",
        entityId: String(input.id),
      });
      return { success: true } as const;
    }),

  ordersList: adminProcedure
    .input(
      z.object({
        status: orderStatusSchema.optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const orders = await getOrdersByFilters(
        input
          ? {
              status: input.status,
              from: input.from ? new Date(input.from) : undefined,
              to: input.to ? new Date(input.to) : undefined,
            }
          : undefined,
      );
    return orders;
  }),

  orderUpdate: adminProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        status: orderStatusSchema.optional(),
        trackingCode: z.string().max(120).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const currentOrder = await getOrderById(input.orderId);
      await setOrderAdminData(input.orderId, {
        status: input.status,
        trackingCode: input.trackingCode,
      });
      const updatedOrder = await getOrderById(input.orderId);
      const user = updatedOrder ? await getUserById(updatedOrder.userId) : undefined;
      const appBaseUrl = String(process.env.APP_URL || process.env.APP_BASE_URL || process.env.FRONTEND_URL || "https://l4ckos.com.br").replace(/\/$/, "");

      if (updatedOrder && user?.email && input.status && input.status !== currentOrder?.status) {
        try {
          if (input.status === "processing") {
            await sendOrderPreparingEmail({
              customerEmail: user.email,
              customerName: user.name || "Cliente",
              orderNumber: String(updatedOrder.id),
              total: formatCurrency(updatedOrder.totalPrice / 100),
            });
          } else if (input.status === "shipped") {
            await sendShippingEmail({
              customerEmail: user.email,
              customerName: user.name || "Cliente",
              orderNumber: String(updatedOrder.id),
              trackingCode: input.trackingCode || updatedOrder.trackingCode || "",
              trackingUrl: `${appBaseUrl}/acompanhar-pedido?pedido=${updatedOrder.id}`,
            });
          } else if (input.status === "delivered") {
            await sendOrderDeliveredEmail({
              customerEmail: user.email,
              customerName: user.name || "Cliente",
              orderNumber: String(updatedOrder.id),
              orderUrl: `${appBaseUrl}/meus-pedidos/${updatedOrder.id}`,
            });
            await sendReviewRequestEmail({
              customerEmail: user.email,
              customerName: user.name || "Cliente",
              orderNumber: String(updatedOrder.id),
              reviewUrl: `${appBaseUrl}/perfil`,
            });
          }
        } catch {}
      }
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "order.update",
        entity: "order",
        entityId: String(input.orderId),
        metadata: { status: input.status, trackingCode: input.trackingCode },
      });
      return { success: true } as const;
    }),

  reviewsList: adminProcedure.query(async () => {
    return await getAdminProductReviews();
  }),

  reviewModerate: adminProcedure
    .input(reviewModerationInputSchema)
    .mutation(async ({ ctx, input }) => {
      await moderateProductReview({
        reviewId: input.reviewId,
        actorUserId: ctx.user.id,
        moderationStatus: input.moderationStatus,
        imageStatus: input.imageStatus,
      });
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "review.moderate",
        entity: "productReview",
        entityId: String(input.reviewId),
        metadata: {
          moderationStatus: input.moderationStatus,
          imageStatus: input.imageStatus,
        },
      });
      return { success: true } as const;
    }),

  couponsList: adminProcedure.query(async () => {
    return await getCoupons();
  }),

  couponCreate: adminProcedure
    .input(
      z.object({
        code: z.string().min(3).max(64),
        type: z.enum(["percent", "fixed"]),
        value: z.number().positive(),
        maxUses: z.number().int().positive().optional().nullable(),
        startsAt: z.string().datetime().optional().nullable(),
        expiresAt: z.string().datetime().optional().nullable(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await createCoupon({
        code: input.code,
        type: input.type,
        value: input.value,
        maxUses: input.maxUses ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        isActive: input.isActive,
      });
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "coupon.create",
        entity: "coupon",
        entityId: input.code.toUpperCase(),
      });
      return { success: true } as const;
    }),

  couponUpdate: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        code: z.string().min(3).max(64).optional(),
        type: z.enum(["percent", "fixed"]).optional(),
        value: z.number().positive().optional(),
        maxUses: z.number().int().positive().optional().nullable(),
        startsAt: z.string().datetime().optional().nullable(),
        expiresAt: z.string().datetime().optional().nullable(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await updateCoupon(input.id, {
        code: input.code,
        type: input.type,
        value: input.value,
        maxUses: input.maxUses,
        startsAt: input.startsAt ? new Date(input.startsAt) : input.startsAt === null ? null : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : input.expiresAt === null ? null : undefined,
        isActive: input.isActive,
      });
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "coupon.update",
        entity: "coupon",
        entityId: String(input.id),
      });
      return { success: true } as const;
    }),

  couponDelete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await deleteCoupon(input.id);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "coupon.delete",
        entity: "coupon",
        entityId: String(input.id),
      });
      return { success: true } as const;
    }),

  promoBannersList: adminProcedure.query(async () => {
    return await getPromoBanners();
  }),

  promoBannerCreate: adminProcedure
    .input(
      z.object({
        badge: z.string().min(1).max(80),
        title: z.string().min(1).max(255),
        description: z.string().min(1).max(1000),
        ctaLabel: z.string().min(1).max(120),
        imageUrl: z.string().trim().max(500).optional().default(""),
        mobileImageUrl: z.string().trim().max(500).optional().default(""),
        imageAlt: z.string().trim().max(255).optional().default(""),
        linkUrl: z.string().trim().max(500).optional().default(""),
        discountText: z.string().trim().max(60).optional().default(""),
        discountLabel: z.string().trim().max(40).optional().default("OFF"),
        bgStyle: z.string().min(1).max(255),
        sortOrder: z.number().int().default(0),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createPromoBanner(input);
      const insertedId = Number((result as any)?.[0]?.insertId ?? 0);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "promoBanner.create",
        entity: "promoBanner",
        entityId: String(insertedId || "new"),
      });
      return { success: true } as const;
    }),

  promoBannerUpdate: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        badge: z.string().min(1).max(80).optional(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().min(1).max(1000).optional(),
        ctaLabel: z.string().min(1).max(120).optional(),
        imageUrl: z.string().trim().max(500).nullable().optional(),
        mobileImageUrl: z.string().trim().max(500).nullable().optional(),
        imageAlt: z.string().trim().max(255).nullable().optional(),
        linkUrl: z.string().trim().max(500).nullable().optional(),
        discountText: z.string().trim().max(60).optional(),
        discountLabel: z.string().trim().max(40).optional(),
        bgStyle: z.string().min(1).max(255).optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updatePromoBanner(id, data);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "promoBanner.update",
        entity: "promoBanner",
        entityId: String(id),
      });
      return { success: true } as const;
    }),

  promoBannerDelete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await deletePromoBanner(input.id);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "promoBanner.delete",
        entity: "promoBanner",
        entityId: String(input.id),
      });
      return { success: true } as const;
    }),

  reportsSalesCsv: adminProcedure
    .input(
      z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
      }),
    )
    .query(async ({ input }) => {
      const from = new Date(input.from);
      const to = new Date(input.to);
      const [summaryRows, ordersRows] = await Promise.all([
        getSalesByPeriod(from, to),
        getOrdersByFilters({ from, to }),
      ]);
      const totalSalesCents = summaryRows.reduce((sum, row) => sum + Number(row.totalSales ?? 0), 0);
      const totalOrders = summaryRows.reduce((sum, row) => sum + Number(row.ordersCount ?? 0), 0);
      const lines = [
        csvRow(["L4CKOS - Relatorio de vendas"]),
        csvRow(["periodFrom", input.from]),
        csvRow(["periodTo", input.to]),
        csvRow(["totalSalesCents", totalSalesCents]),
        csvRow(["totalSalesBRL", (totalSalesCents / 100).toFixed(2)]),
        csvRow(["ordersCount", totalOrders]),
        "",
        csvRow(["section", "date", "totalSalesCents", "totalSalesBRL", "ordersCount"]),
        ...summaryRows.map(row => csvRow(["daily_summary", row.day, row.totalSales, (Number(row.totalSales) / 100).toFixed(2), row.ordersCount])),
        "",
        csvRow([
          "section",
          "orderId",
          "createdAt",
          "status",
          "totalPriceCents",
          "totalPriceBRL",
          "customerName",
          "customerEmail",
          "trackingCode",
          "itemCount",
          "items",
        ]),
        ...ordersRows.map(order => csvRow([
          "order",
          order.id,
          order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
          order.status,
          order.totalPrice,
          (Number(order.totalPrice ?? 0) / 100).toFixed(2),
          order.customerName,
          order.customerEmail,
          order.trackingCode,
          order.items?.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0) ?? 0,
          order.items?.map(item => `${item.productName || `Produto #${item.productId}`} x${item.quantity}`).join("; ") ?? "",
        ])),
      ];
      return {
        fileName: `sales-report-${input.from.slice(0, 10)}-${input.to.slice(0, 10)}.csv`,
        csv: lines.join("\n"),
      };
    }),

  auditList: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(1000).default(300) }).optional())
    .query(async ({ input }) => {
      return await getAuditLogs(input?.limit ?? 300);
    }),

  backupManual: adminProcedure.mutation(async ({ ctx }) => {
    const backup = await getBackupPayload();
    let dir = process.env.BACKUP_DIR || "backups";
    const fileName = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    let filePath = path.join(dir, fileName);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, JSON.stringify(backup, null, 2), "utf-8");
    } catch (error) {
      if (process.env.BACKUP_DIR) throw error;
      dir = path.join("/tmp", "l4ckos-backups");
      filePath = path.join(dir, fileName);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, JSON.stringify(backup, null, 2), "utf-8");
    }
    await createAuditLog({
      actorUserId: ctx.user.id,
      action: "backup.manual",
      entity: "backup",
      entityId: fileName,
    });
    return { fileName, filePath };
  }),

  backupsList: adminProcedure.query(async () => {
    const dir = process.env.BACKUP_DIR || "backups";
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    return files.filter(name => name.endsWith(".json")).sort().reverse();
  }),

  backupRestore: adminProcedure
    .input(z.object({ fileName: backupFileNameSchema, confirmation: z.literal("RESTORE") }))
    .mutation(async ({ ctx, input }) => {
      const dir = process.env.BACKUP_DIR || "backups";
      const baseDir = path.resolve(dir);
      const filePath = path.resolve(baseDir, input.fileName);
      if (!filePath.startsWith(baseDir + path.sep) && filePath !== path.join(baseDir, input.fileName)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nome de arquivo inválido" });
      }
      const raw = await readFile(filePath, "utf-8");
      const payload = JSON.parse(raw) as Parameters<typeof restoreBackupPayload>[0];
      await restoreBackupPayload(payload);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "backup.restore",
        entity: "backup",
        entityId: input.fileName,
      });
      return { success: true } as const;
    }),

  lifecycleEmailSend: adminProcedure
    .input(
      z.object({
        flow: z.enum(["paymentNotFinished", "abandonedCart1", "abandonedCart2", "abandonedCart3"]),
        userId: z.number().int().positive(),
        orderId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await getUserById(input.userId);
      const userEmail = String(user?.email ?? "").trim().toLowerCase();
      if (!user || !userEmail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuário com e-mail válido não encontrado." });
      }

      const appBaseUrl = String(process.env.APP_URL || process.env.APP_BASE_URL || process.env.FRONTEND_URL || "https://l4ckos.com.br").replace(/\/$/, "");

      if (input.flow === "paymentNotFinished") {
        if (!input.orderId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "orderId e obrigatorio para este fluxo." });
        }

        const order = await getOrderById(input.orderId);
        if (!order || order.userId !== input.userId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado para este usuário." });
        }

        await sendPaymentNotFinishedEmail({
          customerEmail: userEmail,
          customerName: user.name || "Cliente",
          orderNumber: String(order.id),
          total: formatCurrency(order.totalPrice / 100),
          paymentUrl: `${appBaseUrl}/checkout`,
          recoveryWindowLabel: "enquanto a cobrança do pedido estiver ativa",
        });
      } else {
        const cart = await getCartItems(input.userId);
        if (cart.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este usuário não possui itens no carrinho." });
        }

        const products = await getProductsByIds(cart.map(item => item.productId));
        const productMap = new Map(products.map(product => [product.id, product]));
        const items = cart.map(item => {
          const product = productMap.get(item.productId);
          return {
            id: item.productId,
            name: product?.name || `Produto #${item.productId}`,
            imageUrl: product?.imageUrl || "",
            price: formatCurrency(Number(product?.price || 0) / 100),
          };
        });

        const payload = {
          email: userEmail,
          name: user.name || "Cliente",
          cartUrl: `${appBaseUrl}/carrinho`,
          products: items,
        };

        if (input.flow === "abandonedCart1") {
          await sendAbandonedCartReminder1Email(payload);
        } else if (input.flow === "abandonedCart2") {
          await sendAbandonedCartReminder2Email(payload);
        } else {
          await sendAbandonedCartReminder3Email(payload);
        }
      }

      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "email.lifecycle.send",
        entity: "email",
        entityId: `${input.flow}:${input.userId}`,
        metadata: input,
      });

      return { success: true } as const;
    }),

  marketingCampaignSend: adminProcedure
    .input(
      z.object({
        campaign: z.enum(["drop", "newProducts", "promotion", "crossSell", "loyaltyCoupon"]),
        audience: z.enum(["waitlist", "allUsers", "vipUsers", "custom"]),
        customEmails: z.array(z.string().email()).optional().default([]),
        productIds: z.array(z.number().int().positive()).optional().default([]),
        couponCode: z.string().trim().min(3).max(64).optional(),
        couponDescription: z.string().trim().max(255).optional(),
        url: z.string().url().optional(),
        batchSize: z.number().int().min(1).max(100).default(25),
        delayMs: z.number().int().min(100).max(5000).default(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const emails = await getAudienceEmails(input.audience, input.customEmails);
      if (emails.length === 0) {
        return {
          success: true,
          total: 0,
          sent: 0,
          failed: 0,
          failures: [],
          message: "Nenhum destinatario encontrado para este publico.",
        } as const;
      }

      const products =
        input.productIds.length > 0
          ? await getProductsByIds(input.productIds)
          : [];

      const normalizedProducts = products.map(product => ({
        id: product.id,
        name: product.name,
        imageUrl: product.imageUrl || "",
        price: formatCurrency(product.price / 100),
      }));

      const failures: Array<{ email: string; message: string }> = [];
      let sent = 0;

      for (let index = 0; index < emails.length; index += input.batchSize) {
        const batch = emails.slice(index, index + input.batchSize);
        for (const email of batch) {
          try {
            const common = {
              email,
              name: "cliente",
            };

            if (input.campaign === "drop") {
              await sendNewDropAnnouncementEmail({
                ...common,
                dropUrl: input.url,
                products: normalizedProducts,
              });
            } else if (input.campaign === "newProducts") {
              await sendNewProductsAnnouncementEmail({
                ...common,
                productsUrl: input.url,
                products: normalizedProducts,
              });
            } else if (input.campaign === "promotion") {
              await sendPromotionEmail({
                ...common,
                promotionUrl: input.url,
                couponCode: input.couponCode,
                couponDescription: input.couponDescription,
              });
            } else if (input.campaign === "crossSell") {
              await sendCrossSellEmail({
                ...common,
                collectionUrl: input.url,
                products: normalizedProducts,
              });
            } else {
              if (!input.couponCode) {
                throw new Error("couponCode e obrigatorio para fidelizacao.");
              }
              await sendLoyaltyCouponEmail({
                ...common,
                couponCode: input.couponCode,
                couponDescription: input.couponDescription,
                shopUrl: input.url,
              });
            }

            sent += 1;
          } catch (error) {
            failures.push({
              email,
              message: error instanceof Error ? error.message : "Falha desconhecida",
            });
          }

          await sleep(input.delayMs);
        }
      }

      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "marketing.campaign.send",
        entity: "emailCampaign",
        entityId: input.campaign,
        metadata: {
          ...input,
          total: emails.length,
          sent,
          failed: failures.length,
        },
      });

      return {
        success: failures.length === 0,
        total: emails.length,
        sent,
        failed: failures.length,
        failures,
        message:
          failures.length === 0
            ? "Disparo concluido com sucesso."
            : "Disparo concluido com falhas parciais.",
      } as const;
    }),

  waitlistLaunchSend: adminProcedure
    .input(
      z.object({
        couponCode: z.string().min(3).max(64),
        discountPercent: z.number().positive().max(100).default(15),
        launchUrl: z.string().url().optional(),
        batchSize: z.number().int().min(1).max(100).default(25),
        delayMs: z.number().int().min(300).max(5000).default(700),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const waitlist = await getAllWaitlistEmails();
      const uniqueEmails = [...new Set(waitlist.map(item => String(item.email ?? "").trim().toLowerCase()).filter(Boolean))];

      if (uniqueEmails.length === 0) {
        return {
          success: true,
          total: 0,
          sent: 0,
          failed: 0,
          failures: [],
          message: "Nenhum email encontrado na lista de espera.",
        } as const;
      }

      const failures: Array<{ email: string; message: string }> = [];
      let sent = 0;

      for (let index = 0; index < uniqueEmails.length; index += input.batchSize) {
        const batch = uniqueEmails.slice(index, index + input.batchSize);
        for (const email of batch) {
          try {
            await sendWaitlistLaunchEmail({
              email,
              couponCode: input.couponCode,
              discountPercent: input.discountPercent,
              launchUrl: input.launchUrl,
            });
            sent += 1;
          } catch (error) {
            failures.push({
              email,
              message: error instanceof Error ? error.message : "Falha desconhecida",
            });
          }

          await sleep(input.delayMs);
        }
      }

      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "waitlist.launch.send",
        entity: "waitlist",
        entityId: input.couponCode.toUpperCase(),
        metadata: {
          total: uniqueEmails.length,
          sent,
          failed: failures.length,
          discountPercent: input.discountPercent,
          launchUrl: input.launchUrl ?? ENV.frontendUrl ?? process.env.APP_BASE_URL ?? "https://l4ckos.com.br",
        },
      });

      return {
        success: failures.length === 0,
        total: uniqueEmails.length,
        sent,
        failed: failures.length,
        failures,
        message:
          failures.length === 0
            ? "Disparo para a lista de espera concluido com sucesso."
            : "Disparo concluido com falhas parciais.",
      } as const;
    }),
});

