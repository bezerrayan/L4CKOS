import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { stockAttemptResumeV1Schema, stockCheckoutHttpRequestV1Schema, stockCheckoutResponseV1Schema, stockCheckoutItemV1Schema, stockShippingQuoteRequestV1Schema } from "../../shared/stockCheckoutV1";
import {
  assertPublicOrSyntheticSandboxCheckoutEnabled,
  PublicCheckoutDisabledError,
  PublicStoreClosedError,
  publicCheckoutDisabledTrpcError,
  publicStoreClosedTrpcError,
} from "../_core/publicStore";
import { protectedProcedure, router } from "../_core/trpc";
import { StockCheckoutError } from "../stock/stockCheckout";
import { createAppError } from "../_core/appErrors";
import { toStockCheckoutResponseV1 } from "../stock/stockCheckoutHttpContract";
import { toTrpcError } from "../exclusive/errors";
import { ExclusiveError } from "../exclusive/store";
import { assertStagingSyntheticBuyerTrpc } from "../payments/syntheticBuyerGate";
import { resolveOwnerPixTestAuthorization, resolveOwnerPixTestReadAuthorization } from "../stock/ownerPixTestGate";

function isPublicCheckoutGateError(error: unknown): boolean {
  if (!(error instanceof TRPCError)) return false;
  const appCode = (error as TRPCError & { appCode?: unknown }).appCode;
  return appCode === "PUBLIC_STORE_CLOSED" || appCode === "PUBLIC_CHECKOUT_DISABLED";
}

/** Same public gate as the legacy routers, surfaced with the V6 FORBIDDEN codes (never an internal error). */
function assertGate(authenticatedUserId: number): void {
  try {
    assertPublicOrSyntheticSandboxCheckoutEnabled(authenticatedUserId);
  } catch (error) {
    if (error instanceof PublicStoreClosedError) throw publicStoreClosedTrpcError();
    if (error instanceof PublicCheckoutDisabledError) throw publicCheckoutDisabledTrpcError();
    throw error;
  }
}

/** Ordinary public/staging admission wins; the owner exception is evaluated only when that gate is closed. */
function assertGateOrOwnerPixTest(user: { id: number; openId: string; role: string }) {
  try {
    assertGate(user.id);
    return null;
  } catch (error) {
    if (!isPublicCheckoutGateError(error)) throw error;
    const ownerTest = resolveOwnerPixTestAuthorization(user);
    if (ownerTest) return ownerTest;
    throw error;
  }
}

/** Closed-store recovery is read-only and can address only the one server-configured owner attempt. */
function assertReadGateOrOwnerPixTest(user: { id: number; openId: string; role: string }) {
  try {
    assertGate(user.id);
    return null;
  } catch (error) {
    if (!isPublicCheckoutGateError(error)) throw error;
    const ownerRead = resolveOwnerPixTestReadAuthorization(user);
    if (ownerRead) return ownerRead;
    throw error;
  }
}

function mapCheckoutError(error: unknown): never {
  if (!(error instanceof StockCheckoutError)) throw error;
  if (error.code === "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION") {
    throw createAppError({
      trpcCode: "BAD_REQUEST",
      appCode: "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION",
      message: "Este produto está temporariamente indisponível para compra pública.",
    });
  }
  if (error.code === "CHECKOUT_ATTEMPT_NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tentativa não encontrada." });
  }
  if (error.code === "CHECKOUT_STOCK_INSUFFICIENT" || error.code === "CHECKOUT_VARIANT_INACTIVE" || error.code === "CHECKOUT_BATCH_CAPACITY_EXCEEDED" || error.code === "CHECKOUT_BATCH_UNAVAILABLE" || error.code === "CHECKOUT_BATCH_REQUIRED") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "STOCK_UNAVAILABLE", message: "Estoque indisponível para esta variante." });
  }
  if (error.code === "CHECKOUT_SHIPPING_QUOTE_REJECTED") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "SHIPPING_QUOTE_REJECTED", message: "O frete escolhido não é mais válido. Recalcule o frete e tente novamente." });
  }
  if (error.code === "CHECKOUT_ATTEMPT_EXPIRED") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "CHECKOUT_ATTEMPT_EXPIRED", message: "Esta tentativa expirou. Inicie uma nova tentativa." });
  }
  if (error.code === "OWNER_PIX_TEST_AMOUNT_LIMIT") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "OWNER_PIX_TEST_AMOUNT_LIMIT", message: "O valor desta tentativa excede o limite autorizado." });
  }
  if (error.code === "CHECKOUT_ALREADY_PAID" || error.code === "CHECKOUT_ATTEMPT_RELEASED" || error.code === "CHECKOUT_ATTEMPT_CHANGED" || error.code === "CHECKOUT_ATTEMPT_NOT_REUSABLE") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "CHECKOUT_ATTEMPT_NOT_REUSABLE", message: "Esta tentativa não pode ser repetida com os dados atuais." });
  }
  if (error.code === "CHECKOUT_PROVIDER_OUTCOME_UNKNOWN" || error.code === "CHECKOUT_PROVIDER_RECONCILIATION_REQUIRED" || error.code === "CHECKOUT_RECONCILIATION_REQUIRED" || error.code === "CHECKOUT_PAYMENT_CORRELATION_REQUIRED") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "PAYMENT_UNDER_ANALYSIS", message: "O pagamento está em análise. Não inicie outra tentativa." });
  }
  if (error.code === "AUTHENTICATION_REQUIRED") {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Autenticação obrigatória." });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "Não foi possível iniciar o checkout STOCK." });
}

export const stockCheckoutRouter = router({
  /** Server-signed freight options for a cart + full destination address. Prices are never client-supplied. */
  quoteShipping: protectedProcedure
    .input(stockShippingQuoteRequestV1Schema)
    .mutation(async ({ ctx, input }) => {
      assertStagingSyntheticBuyerTrpc(ctx.user.id);
      assertGateOrOwnerPixTest(ctx.user);
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Checkout STOCK indisponível neste runtime." });
      try {
        const result = await runtime.quoteShipping(input);
        if (!result) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Frete por transportadora indisponível." });
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error instanceof StockCheckoutError) mapCheckoutError(error);
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Não foi possível consultar o frete agora." });
      }
    }),

  create: protectedProcedure
    .input(stockCheckoutHttpRequestV1Schema)
    .mutation(async ({ ctx, input }) => {
      // Gate before runtime lookup, pool access, reservation writes, or provider calls.
      assertStagingSyntheticBuyerTrpc(ctx.user.id);
      const ownerPixTest = assertGateOrOwnerPixTest(ctx.user);
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Checkout STOCK indisponível neste runtime." });
      try {
        const effectiveAttemptId = ownerPixTest?.attemptId ?? input.attemptId;
        const effectiveInput = ownerPixTest ? { ...input, attemptId: ownerPixTest.attemptId } : input;
        const result = ownerPixTest
          ? await runtime.checkoutOwnerPixTest(effectiveInput, ctx.user)
          : await runtime.checkout(input, ctx.user.id);
        return stockCheckoutResponseV1Schema.parse(toStockCheckoutResponseV1(effectiveAttemptId, result));
      } catch (error) {
        if (error instanceof ExclusiveError) throw toTrpcError(error);
        mapCheckoutError(error);
      }
    }),

  resume: protectedProcedure
    .input(z.object({
      attemptId: stockAttemptResumeV1Schema.shape.attemptId,
      items: z.array(stockCheckoutItemV1Schema).min(1).max(30).optional(),
    }).strict())
    .query(async ({ ctx, input }) => {
      assertStagingSyntheticBuyerTrpc(ctx.user.id);
      const ownerPixRead = assertReadGateOrOwnerPixTest(ctx.user);
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Retomada STOCK indisponível neste runtime." });
      try {
        // Ignore browser/local IDs whenever the public gate is closed. The owner can read only the configured attempt.
        const attemptId = ownerPixRead?.attemptId ?? input.attemptId;
        const resumed = input.items
          ? await runtime.resume(ctx.user.id, attemptId, input.items)
          : await runtime.resume(ctx.user.id, attemptId);
        return stockAttemptResumeV1Schema.parse(resumed);
      } catch (error) {
        if (error instanceof StockCheckoutError && error.code === "CHECKOUT_ATTEMPT_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Tentativa não encontrada." });
        }
        if (error instanceof StockCheckoutError && error.code === "STOCK_ATTEMPT_ID_INVALID") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Tentativa inválida." });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar a tentativa." });
      }
    }),

  resumeLatest: protectedProcedure
    .input(z.object({ items: z.array(stockCheckoutItemV1Schema).min(1).max(30).optional() }).strict().optional())
    .query(async ({ ctx, input }) => {
      assertStagingSyntheticBuyerTrpc(ctx.user.id);
      const ownerPixRead = assertReadGateOrOwnerPixTest(ctx.user);
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Retomada STOCK indisponível neste runtime." });
      if (ownerPixRead) {
        // Never return another latest checkout URL, even after the create window has closed.
        try {
          const resumed = input?.items
            ? await runtime.resume(ctx.user.id, ownerPixRead.attemptId, input.items)
            : await runtime.resume(ctx.user.id, ownerPixRead.attemptId);
          return stockAttemptResumeV1Schema.parse(resumed);
        } catch (error) {
          if (error instanceof StockCheckoutError && error.code === "CHECKOUT_ATTEMPT_NOT_FOUND") return null;
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar a tentativa." });
        }
      }
      if (!runtime.resumeLatest) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Retomada STOCK indisponível neste runtime." });
      return input?.items ? runtime.resumeLatest(ctx.user.id, input.items) : runtime.resumeLatest(ctx.user.id);
    }),
});
