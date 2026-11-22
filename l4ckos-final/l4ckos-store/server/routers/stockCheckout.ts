import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { stockAttemptResumeV1Schema, stockCheckoutHttpRequestV1Schema, stockCheckoutResponseV1Schema, stockShippingQuoteRequestV1Schema } from "../../shared/stockCheckoutV1";
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
import { resolveOwnerPixTestAuthorization } from "../stock/ownerPixTestGate";

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
    const ownerTest = resolveOwnerPixTestAuthorization(user);
    if (ownerTest) return ownerTest;
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
        const result = ownerPixTest
          ? await runtime.checkoutOwnerPixTest(input, ctx.user)
          : await runtime.checkout(input, ctx.user.id);
        return stockCheckoutResponseV1Schema.parse(toStockCheckoutResponseV1(effectiveAttemptId, result));
      } catch (error) {
        if (error instanceof ExclusiveError) throw toTrpcError(error);
        mapCheckoutError(error);
      }
    }),

  resume: protectedProcedure
    .input(stockAttemptResumeV1Schema.pick({ attemptId: true }).strict())
    .query(async ({ ctx, input }) => {
      assertStagingSyntheticBuyerTrpc(ctx.user.id);
      const ownerPixTest = assertGateOrOwnerPixTest(ctx.user);
      if (ownerPixTest && input.attemptId !== ownerPixTest.attemptId) throw publicCheckoutDisabledTrpcError();
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Retomada STOCK indisponível neste runtime." });
      try {
        return stockAttemptResumeV1Schema.parse(await runtime.resume(ctx.user.id, input.attemptId));
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
    .input(z.object({}).strict().optional())
    .query(async ({ ctx }) => {
      assertStagingSyntheticBuyerTrpc(ctx.user.id);
      const ownerPixTest = assertGateOrOwnerPixTest(ctx.user);
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Retomada STOCK indisponível neste runtime." });
      if (ownerPixTest) {
        // Keep the owner exception scoped to its configured attempt; never return another latest checkout URL.
        try {
          return stockAttemptResumeV1Schema.parse(await runtime.resume(ctx.user.id, ownerPixTest.attemptId));
        } catch (error) {
          if (error instanceof StockCheckoutError && error.code === "CHECKOUT_ATTEMPT_NOT_FOUND") return null;
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar a tentativa." });
        }
      }
      if (!runtime.resumeLatest) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Retomada STOCK indisponível neste runtime." });
      return runtime.resumeLatest(ctx.user.id);
    }),
});
