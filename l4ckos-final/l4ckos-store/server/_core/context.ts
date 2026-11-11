import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { AuthenticationBackendUnavailableError, sdk } from "./sdk";
import { TRPCError } from "@trpc/server";
import type { StockCheckoutRuntime } from "../stock/stockCheckoutRuntime";

let localHarnessStockRuntime: StockCheckoutRuntime | undefined;
let serverStockRuntime: StockCheckoutRuntime | undefined;

function isDisposableStockHarness(): boolean {
  return process.env.NODE_ENV !== "production" &&
    process.env.STOCK_LOCAL_HARNESS === "true" &&
    /^(127\.0\.0\.1|localhost|::1)$/.test(process.env.STOCK_MYSQL_HOST ?? "") &&
    process.env.STOCK_MYSQL_DATABASE === "l4ckos_stock_test" &&
    process.env.STOCK_MYSQL_USER === "stock_test";
}

/** Runtime injection is deliberately impossible outside the loopback fixture database. */
export function configureStockCheckoutRuntimeForLocalHarness(runtime: StockCheckoutRuntime | undefined): void {
  if (runtime && (!isDisposableStockHarness() || !runtime.isForDisposableLocalHarness())) {
    throw new Error("STOCK_RUNTIME_INJECTION_REQUIRES_DISPOSABLE_LOOPBACK_HARNESS");
  }
  localHarnessStockRuntime = runtime;
}

/** Runtime composition requires an explicit server flag; checkout remains separately gated. */
export function configureStockCheckoutRuntimeForServer(runtime: StockCheckoutRuntime): void {
  if (process.env.STOCK_RUNTIME_ENABLED !== "true") {
    throw new Error("STOCK_RUNTIME_FLAG_REQUIRED");
  }
  serverStockRuntime = runtime;
}

export function getConfiguredStockCheckoutRuntime(): StockCheckoutRuntime | undefined {
  if (isDisposableStockHarness()) return localHarnessStockRuntime;
  return process.env.STOCK_RUNTIME_ENABLED === "true" ? serverStockRuntime : undefined;
}

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Only injected by an isolated local harness or explicitly configured runtime. */
  stockCheckoutRuntime?: StockCheckoutRuntime;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    if (error instanceof AuthenticationBackendUnavailableError) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Autenticação temporariamente indisponível." });
    }
    // Authentication is optional for public procedures.
    user = null;
  }

  const stockCheckoutRuntime = getConfiguredStockCheckoutRuntime();
  return {
    req: opts.req,
    res: opts.res,
    user,
    ...(stockCheckoutRuntime ? { stockCheckoutRuntime } : {}),
  };
}
