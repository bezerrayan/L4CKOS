import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { createAuditLog } from "../db";
import {
  accessCodeInputSchema,
  accessRequestStatusSchema,
  adminApproveInputSchema,
  adminSaveDropInputSchema,
} from "../../shared/exclusiveDropsV1";
import { toTrpcError } from "../exclusive/errors";
import { getExclusiveStore } from "../exclusive/runtime";
import type { ExclusiveStore } from "../exclusive/store";

async function store(): Promise<ExclusiveStore> {
  const found = await getExclusiveStore();
  if (!found) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Drops exclusivos indisponíveis neste ambiente." });
  return found;
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toTrpcError(error);
  }
}

/** Decisions are audited in the existing audit log. Codes and hashes are NEVER part of the metadata. */
const audit = (actorUserId: number, action: string, entityId: number, metadata: Record<string, unknown> = {}) =>
  createAuditLog({ actorUserId, action: `exclusive.${action}`, entity: "exclusiveAccessRequest", entityId: String(entityId), metadata }).catch(() => undefined);

export const exclusiveDropsRouter = router({
  /** Public: drop information for a product page, plus the caller's own access status when signed in. */
  forProduct: publicProcedure
    .input(z.object({ productId: z.number().int().positive() }).strict())
    .query(({ ctx, input }) => run(async () => (await store()).productDrop(input.productId, ctx.user?.id ?? null))),

  requestAccess: protectedProcedure
    .input(z.object({ dropId: z.number().int().positive() }).strict())
    .mutation(({ ctx, input }) => run(async () => (await store()).requestAccess(ctx.user.id, input.dropId))),

  myRequests: protectedProcedure.query(({ ctx }) => run(async () => (await store()).myRequests(ctx.user.id))),

  redeemCode: protectedProcedure
    .input(accessCodeInputSchema)
    .mutation(({ ctx, input }) => run(async () => (await store()).redeemCode(ctx.user.id, input.code))),

  admin: router({
    listDrops: adminProcedure.query(() => run(async () => (await store()).listDrops())),

    saveDrop: adminProcedure.input(adminSaveDropInputSchema).mutation(({ ctx, input }) => run(async () => {
      const result = await (await store()).saveDrop(input, ctx.user.id);
      await audit(ctx.user.id, input.id ? "drop_updated" : "drop_created", result.dropId, { slug: input.slug, status: input.status });
      return result;
    })),

    listRequests: adminProcedure
      .input(z.object({ dropId: z.number().int().positive().optional(), status: accessRequestStatusSchema.optional() }).strict().default({}))
      .query(({ input }) => run(async () => (await store()).listRequests(input))),

    approve: adminProcedure.input(adminApproveInputSchema).mutation(({ ctx, input }) => run(async () => {
      const result = await (await store()).approve({ requestId: input.requestId, unitLimit: input.unitLimit, expiresAt: input.expiresAt, actorUserId: ctx.user.id });
      await audit(ctx.user.id, "approved", input.requestId, { grantId: result.grantId, unitLimit: input.unitLimit, expiresAt: result.expiresAt });
      // The plaintext code is returned once, to the approving admin only.
      return result;
    })),

    reject: adminProcedure.input(z.object({ requestId: z.number().int().positive() }).strict()).mutation(({ ctx, input }) => run(async () => {
      const result = await (await store()).reject({ requestId: input.requestId, actorUserId: ctx.user.id });
      await audit(ctx.user.id, "rejected", input.requestId);
      return result;
    })),

    revoke: adminProcedure.input(z.object({ requestId: z.number().int().positive() }).strict()).mutation(({ ctx, input }) => run(async () => {
      const result = await (await store()).revoke({ requestId: input.requestId, actorUserId: ctx.user.id });
      await audit(ctx.user.id, "revoked", input.requestId);
      return result;
    })),

    reissueCode: adminProcedure.input(z.object({ requestId: z.number().int().positive() }).strict()).mutation(({ ctx, input }) => run(async () => {
      const result = await (await store()).reissueCode({ requestId: input.requestId, actorUserId: ctx.user.id });
      await audit(ctx.user.id, "code_reissued", input.requestId, { grantId: result.grantId });
      return result;
    })),

    history: adminProcedure
      .input(z.object({ dropId: z.number().int().positive().optional(), requestId: z.number().int().positive().optional() }).strict().default({}))
      .query(({ input }) => run(async () => (await store()).history(input))),
  }),
});
