import { purchasedSalesMode, purchasedScheduleMessages } from "../../shared/preorder";
﻿import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  createAuditLog,
  createCoupon,
  createProductWithCatalog,
  deleteProduct,
  deleteCoupon,
  getCartItems,
  getAuditLogs,
  getBackupPayload,
  getCoupons,
  getPromoBanners,
  getHomeHighlightSettings,
  updateHomeHighlightSettings,
  createPromoBanner,
  updatePromoBanner,
  deletePromoBanner,
  getDashboardKpis,
  getAllOrders,
  getAllWaitlistEmails,
  getOrderById,
  getOrderReservationItems,
  getProductsByIds,
  getUserById,
  getOrdersByFilters,
  getAdminSalesReport,
  SalesReportTooLargeError,
  SALES_REPORT_MAX_ORDERS,
  getProductsAdmin,
  getAdminProductReviews,
  markOrderPaid,
  getUsersWithStats,
  ProductCatalogConflictError,
  restoreBackupPayload,
  updateOrderAndReserveDeliveredEmailEvents,
  setUserFlags,
  moderateProductReview,
  updateProductWithCatalog,
  updateCoupon,
  updateUserRole,
} from "../db";
import { renderSalesReportPdf } from "../reports/salesReport";
import { reviewModerationInputSchema } from "../reviews/policy";
import {
  isTrustedPaymentConfirmation,
  manualPaymentConfirmationInputSchema,
} from "../payments/confirmation";
import { resolveAnnouncementUrl } from "../services/email/publicUrls";
import { ENV } from "../_core/env";
import { TRPCError } from "@trpc/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createBackupFile, listBackupFileNames } from "../database/backupFiles";
import {
  sendAbandonedCartReminder1Email,
  sendAbandonedCartReminder2Email,
  sendAbandonedCartReminder3Email,
  sendCrossSellEmail,
  sendLoyaltyCouponEmail,
  sendNewDropAnnouncementEmail,
  sendNewProductsAnnouncementEmail,
  sendPaymentApprovedEmail,
  sendOrderPreparingEmail,
  sendPaymentNotFinishedEmail,
  sendPromotionEmail,
  sendShippingEmail,
  sendWaitlistLaunchEmail,
} from "../services/emailService.js";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import { dispatchOrderEmailEvent } from "../services/orderEmailDelivery";

const variantCreateSchema = z.object({
  color: z.string().trim().min(1).max(60),
  size: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120).optional(),
  sku: z.string().trim().min(1).max(120),
  price: z.number().int().min(0).nullable(),
  stock: z.number().int().min(0),
  isActive: z.boolean(),
}).strict();

const variantUpdateSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().max(60).nullable().optional(),
  size: z.string().trim().max(60).nullable().optional(),
  sku: z.string().trim().max(120).nullable().optional(),
  price: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
}).strict().superRefine((variant, ctx) => {
  if (variant.id === undefined && (!variant.color || !variant.size || !variant.sku || variant.stock === undefined || variant.isActive === undefined || variant.price === undefined)) {
    ctx.addIssue({ code: "custom", message: "Nova variante exige cor, tamanho, SKU, preço, estoque e disponibilidade explícitos." });
  }
  if (variant.isActive === true && (!variant.color || !variant.size || !variant.sku)) {
    ctx.addIssue({ code: "custom", message: "Para ativar, informe cor, tamanho e SKU revisados." });
  }
});

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
function isSafePromoUrl(value: string) {
  const target = value.trim();
  if (!target) return true;
  if (/[\u0000-\u001f\u007f]/.test(target) || target.includes("\\")) return false;
  if (target.startsWith("/")) return !target.startsWith("//");
  try {
    const parsed = new URL(target);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
const promoImageUrlSchema = z.string().trim().max(500).refine(isSafePromoUrl, "Use um caminho local ou uma URL HTTP(S) válida.");
const promoLinkUrlSchema = z.string().trim().max(500).refine(isSafePromoUrl, "O destino deve ser um caminho local ou uma URL HTTP(S) válida.");

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
        ...(cover.alt !== undefined ? { alt: cover.alt } : {}),
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
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[\u0000-\u0020]*[=+@-]/.test(text)) text = `'${text}`;
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
    return users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVip: user.isVip,
      isBlocked: user.isBlocked,
      ordersCount: user.ordersCount,
      createdAt: user.createdAt,
      lastSignedIn: user.lastSignedIn,
    }));
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
            alt: z.string().trim().max(255).nullable().optional(),
          }),
        ).optional().default([]),
        variants: z.array(variantCreateSchema).optional().default([]),
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
      let created: Awaited<ReturnType<typeof createProductWithCatalog>>;
      try {
        created = await createProductWithCatalog({
          product: productData,
          images: buildProductImageList(productData, images),
          variants,
        });
      } catch (error) {
        if (error instanceof ProductCatalogConflictError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
        }
        console.error("[admin.productCreate] catalog transaction failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível salvar o produto e seus dados de catálogo. Nenhuma alteração parcial foi mantida.",
          cause: error,
        });
      }
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "product.create",
        entity: "product",
        entityId: String(created.productId),
        metadata: { name: productData.name, category: productData.category },
      });
      return { success: true, ...created } as const;
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
            alt: z.string().trim().max(255).nullable().optional(),
          }),
        ).optional(),
        variants: z.array(variantUpdateSchema).optional(),
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
      let result: Awaited<ReturnType<typeof updateProductWithCatalog>>;
      try {
        result = await updateProductWithCatalog({
          id,
          product: data,
          ...(images !== undefined ? { images: buildProductImageList(data, images) } : {}),
          ...(variants !== undefined ? { variants } : {}),
        });
      } catch (error) {
        if (error instanceof ProductCatalogConflictError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
        }
        console.error("[admin.productUpdate] catalog transaction failed", {
          productId: id,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível salvar as alterações do produto e do catálogo. Nenhuma alteração parcial foi mantida.",
          cause: error,
        });
      }
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "product.update",
        entity: "product",
        entityId: String(id),
        metadata: data,
      });
      return result;
    }),

  productDelete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await deleteProduct(input.id);
      } catch (error) {
        if (error instanceof ProductCatalogConflictError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
        }
        throw error;
      }
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
      if (!currentOrder) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado." });
      }
      if (
        input.status
        && ["paid", "processing", "shipped", "delivered"].includes(input.status)
        && !isTrustedPaymentConfirmation(currentOrder)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirme o pagamento pelo botão próprio antes de avançar o pedido.",
        });
      }
      const transition = await updateOrderAndReserveDeliveredEmailEvents(input.orderId, {
        status: input.status,
        trackingCode: input.trackingCode,
      }, ctx.user.id);
      const updatedOrder = transition.updatedOrder;
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
            // Attempt both durable events on each real transition to delivered.
            // The database claim decides whether an event is pending/failed and
            // can be processed; sent events and concurrent claims are no-ops.
            for (const eventType of ["order_delivered_email", "review_request_email"] as const) {
              await dispatchOrderEmailEvent({
                orderId: updatedOrder.id,
                eventType,
                customerEmail: user.email,
                customerName: user.name || "Cliente",
                appBaseUrl,
              });
            }
          }
        } catch (error) {
          console.error("[OrderEmailEvent] unexpected dispatch error", {
            orderId: updatedOrder.id,
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
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

  orderConfirmPayment: adminProcedure
    .input(manualPaymentConfirmationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const currentOrder = await getOrderById(input.orderId);
      if (!currentOrder) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado." });
      }
      if (currentOrder.status === "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Não é possível confirmar o pagamento de um pedido cancelado.",
        });
      }

      const result = await markOrderPaid(input.orderId, {
        source: "manual",
        actorUserId: ctx.user.id,
      });

      if ('invalidTransition' in result && result.invalidTransition) {
        throw new TRPCError({ code: "CONFLICT", message: "Pagamento não aplicado ao pedido: cancelamento ou reserva indisponível. Confira a evidência financeira e faça a conciliação; não repita a cobrança." });
      }

      if (result.updated) {
        const user = await getUserById(currentOrder.userId);
        if (user?.email) {
          try {
            const purchasedItems = await getOrderReservationItems(currentOrder.id);
            await sendPaymentApprovedEmail({
              salesMode: purchasedSalesMode(purchasedItems),
              scheduleMessages: purchasedScheduleMessages(purchasedItems),
              customerEmail: user.email,
              customerName: user.name || "Cliente",
              orderNumber: String(currentOrder.id),
              total: formatCurrency(currentOrder.totalPrice / 100),
            });
          } catch {}
        }
      }

      return {
        success: true,
        updated: result.updated,
        paymentConfirmedAt: result.paymentConfirmedAt ?? currentOrder.paymentConfirmedAt,
      } as const;
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

  homeHighlightSettingsGet: adminProcedure.query(async () => {
    let settings: Awaited<ReturnType<typeof getHomeHighlightSettings>>;
    try {
      settings = await getHomeHighlightSettings();
    } catch (error) {
      const databaseError = error as { code?: string; errno?: number };
      if (databaseError.code === "ER_NO_SUCH_TABLE" || databaseError.errno === 1146) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "As configurações dos destaques da Home ainda não estão disponíveis nesta versão do banco. Verifique a migration 0024.",
          cause: error,
        });
      }
      throw error;
    }
    if (!settings) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "As configurações dos destaques da Home não estão disponíveis. Verifique a versão do banco de dados.",
      });
    }
    return {
      id: settings.id,
      displayMode: settings.displayMode,
      rotationIntervalSeconds: settings.rotationIntervalSeconds as 5 | 8 | 10,
      updatedAt: settings.updatedAt,
    };
  }),

  homeHighlightSettingsUpdate: adminProcedure
    .input(z.object({
      displayMode: z.enum(["single", "rotate"]),
      rotationIntervalSeconds: z.union([z.literal(5), z.literal(8), z.literal(10)]),
    }))
    .mutation(async ({ ctx, input }) => {
      let settings: Awaited<ReturnType<typeof updateHomeHighlightSettings>>;
      try {
        settings = await updateHomeHighlightSettings(input);
      } catch (error) {
        const databaseError = error as { code?: string; errno?: number; message?: string };
        if (databaseError.code === "ER_NO_SUCH_TABLE" || databaseError.errno === 1146 || databaseError.message?.includes("row missing")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "As configurações dos destaques da Home não estão disponíveis. Verifique se a migration 0024 foi aplicada.",
            cause: error,
          });
        }
        throw error;
      }
      if (!settings) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "As configurações dos destaques da Home não estão disponíveis.",
        });
      }
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "homeHighlights.settings.update",
        entity: "homeHighlightSettings",
        entityId: "1",
        metadata: { displayMode: settings.displayMode, rotationIntervalSeconds: settings.rotationIntervalSeconds },
      });
      return {
        id: settings.id,
        displayMode: settings.displayMode,
        rotationIntervalSeconds: settings.rotationIntervalSeconds as 5 | 8 | 10,
        updatedAt: settings.updatedAt,
      };
    }),

  promoBannerCreate: adminProcedure
    .input(
      z.object({
        badge: z.string().min(1).max(80),
        title: z.string().min(1).max(255),
        description: z.string().min(1).max(1000),
        ctaLabel: z.string().min(1).max(120),
        imageUrl: promoImageUrlSchema.optional().default(""),
        mobileImageUrl: promoImageUrlSchema.optional().default(""),
        imageAlt: z.string().trim().max(255).optional().default(""),
        linkUrl: promoLinkUrlSchema.optional().default(""),
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
        imageUrl: promoImageUrlSchema.nullable().optional(),
        mobileImageUrl: promoImageUrlSchema.nullable().optional(),
        imageAlt: z.string().trim().max(255).nullable().optional(),
        linkUrl: promoLinkUrlSchema.nullable().optional(),
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
      }).refine(({ from, to }) => new Date(from).getTime() <= new Date(to).getTime(), "A data inicial deve ser anterior ou igual à data final."),
    )
    .query(async ({ ctx, input }) => {
      const from = new Date(input.from);
      const to = new Date(input.to);
      let report;
      try {
        report = await getAdminSalesReport(from, to);
      } catch (error) {
        if (error instanceof SalesReportTooLargeError) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: error.message });
        }
        throw error;
      }
      const ordersRows = await getOrdersByFilters({ from, to });
      if (ordersRows.length > SALES_REPORT_MAX_ORDERS) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: `O período contém mais de ${SALES_REPORT_MAX_ORDERS} pedidos. Selecione um intervalo menor.` });
      }
      const summaryRows = report.daily.map(row => ({ day: row.day, totalSales: row.totalCents, ordersCount: row.ordersCount }));
      const totalSalesCents = report.ordersTotalCents;
      const totalOrders = report.ordersCount;
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
      await createAuditLog({ actorUserId: ctx.user.id, action: "report.export.csv", entity: "report", metadata: { from: input.from, to: input.to, rows: ordersRows.length } });
      return {
        fileName: `sales-report-${input.from.slice(0, 10)}-${input.to.slice(0, 10)}.csv`,
        csv: lines.join("\n"),
      };
    }),

  reportsSummary: adminProcedure
    .input(z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    }).refine(({ from, to }) => new Date(from).getTime() <= new Date(to).getTime(), "A data inicial deve ser anterior ou igual à data final."))
    .query(async ({ input }) => {
      try {
        return await getAdminSalesReport(new Date(input.from), new Date(input.to));
      } catch (error) {
        if (error instanceof SalesReportTooLargeError) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: error.message });
        }
        throw error;
      }
    }),

  reportsSalesPdf: adminProcedure
    .input(z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    }).refine(({ from, to }) => new Date(from).getTime() <= new Date(to).getTime(), "A data inicial deve ser anterior ou igual à data final."))
    .mutation(async ({ ctx, input }) => {
      let report;
      try {
        report = await getAdminSalesReport(new Date(input.from), new Date(input.to));
      } catch (error) {
        if (error instanceof SalesReportTooLargeError) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: error.message });
        }
        throw error;
      }
      const pdf = renderSalesReportPdf(report);
      await createAuditLog({ actorUserId: ctx.user.id, action: "report.export.pdf", entity: "report", metadata: { from: input.from, to: input.to, orders: report.ordersCount } });
      return {
        fileName: `relatorio-pedidos-${input.from.slice(0, 10)}-${input.to.slice(0, 10)}.pdf`,
        pdfBase64: pdf.toString("base64"),
      };
    }),

  auditList: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(1000).default(300) }).optional())
    .query(async ({ input }) => {
      return await getAuditLogs(input?.limit ?? 300);
    }),

  backupManual: adminProcedure.mutation(async ({ ctx }) => {
    try {
      const { fileName } = await createBackupFile(process.env.BACKUP_DIR || "backups", "manual", getBackupPayload);
      await createAuditLog({
        actorUserId: ctx.user.id,
        action: "backup.manual",
        entity: "backup",
        entityId: fileName,
      });
      return { fileName };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "BACKUP_OPERATION_FAILED" });
    }
  }),

  backupsList: adminProcedure.query(async () => {
    return listBackupFileNames(process.env.BACKUP_DIR || "backups");
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
      const launchUrl = resolveAnnouncementUrl(input.launchUrl);
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
              launchUrl,
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
          launchUrl,
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

