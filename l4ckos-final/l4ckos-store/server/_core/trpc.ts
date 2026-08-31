import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { ENV } from "./env";
import { getPublicAppError } from "./appErrors";
import { isOperationalWriteBlocked } from "./operationalConfig";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const appError = getPublicAppError(error);

    return {
      ...shape,
      message: appError.message,
      data: {
        ...shape.data,
        appError,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

function isAllowedAdminEmail(email?: string | null) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return Boolean(normalized) && ENV.adminEmails.includes(normalized);
}

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin' || !isAllowedAdminEmail(ctx.user.email)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    if (opts.type === "mutation" && isOperationalWriteBlocked()) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Ações administrativas estão bloqueadas durante a manutenção." });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
