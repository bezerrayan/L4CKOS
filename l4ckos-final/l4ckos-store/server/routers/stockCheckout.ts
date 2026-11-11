import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { stockAttemptResumeV1Schema, stockCheckoutHttpRequestV1Schema, stockCheckoutResponseV1Schema } from "../../shared/stockCheckoutV1";
import {
  assertPublicCheckoutEnabled,
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

/** Same public gate as the legacy routers, surfaced with the V6 FORBIDDEN codes (never an internal error). */
function assertGate(): void {
  try {
    assertPublicCheckoutEnabled();
  } catch (error) {
    if (error instanceof PublicStoreClosedError) throw publicStoreClosedTrpcError();
    if (error instanceof PublicCheckoutDisabledError) throw publicCheckoutDisabledTrpcError();
    throw error;
  }
}

function mapCheckoutError(error: unknown): never {
  if (!(error instanceof StockCheckoutError)) throw error;
  if (error.code === "CHECKOUT_ATTEMPT_NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tentativa não encontrada." });
  }
  if (error.code === "CHECKOUT_STOCK_INSUFFICIENT" || error.code === "CHECKOUT_VARIANT_INACTIVE") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "STOCK_UNAVAILABLE", message: "Estoque indisponível para esta variante." });
  }
  if (error.code === "CHECKOUT_ATTEMPT_EXPIRED") {
    throw createAppError({ trpcCode: "CONFLICT", appCode: "CHECKOUT_ATTEMPT_EXPIRED", message: "Esta tentativa expirou. Inicie uma nova tentativa." });
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
  create: protectedProcedure
    .input(stockCheckoutHttpRequestV1Schema)
    .mutation(async ({ ctx, input }) => {
      // Gate before runtime lookup, pool access, reservation writes, or provider calls.
      assertGate();
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Checkout STOCK indisponível neste runtime." });
      try {
        const result = await runtime.checkout(input, ctx.user.id);
        return stockCheckoutResponseV1Schema.parse(toStockCheckoutResponseV1(input.attemptId, result));
      } catch (error) {
        if (error instanceof ExclusiveError) throw toTrpcError(error);
        mapCheckoutError(error);
      }
    }),

  resume: protectedProcedure
    .input(stockAttemptResumeV1Schema.pick({ attemptId: true }).strict())
    .query(async ({ ctx, input }) => {
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
      const runtime = ctx.stockCheckoutRuntime;
      if (!runtime?.resumeLatest) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Retomada STOCK indisponível neste runtime." });
      return runtime.resumeLatest(ctx.user.id);
    }),
});
