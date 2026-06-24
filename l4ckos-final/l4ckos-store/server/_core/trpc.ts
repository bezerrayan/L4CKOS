import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getPublicAppError } from "./appErrors";
import { requireAuth, requireRole } from "./authz";

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
  const user = requireAuth(ctx.user);

  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const user = requireRole(ctx.user, "admin");

    return next({
      ctx: {
        ...ctx,
        user,
      },
    });
  }),
);
