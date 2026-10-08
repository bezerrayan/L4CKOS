import { createConnection, type Connection } from "mysql2/promise";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import {
  BatchError,
  batchEditSchema,
  batchAssignmentSchema,
  batchTransitionSchema,
  listBatches,
  productionSummary,
  saveBatch,
  assignBatchProducts,
  transitionBatch,
} from "../database/productionBatches";
async function withConnection<T>(fn: (c: Connection) => Promise<T>) {
  if (!process.env.DATABASE_URL)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  const c = await createConnection({
    uri: process.env.DATABASE_URL,
    timezone: "Z",
    socketPath: process.env.L4CKOS_LOCAL_MYSQL_SOCKET,
  });
  try {
    return await fn(c);
  } catch (error) {
    if (error instanceof BatchError)
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    throw error;
  } finally {
    await c.end();
  }
}
export const productionBatchesRouter = router({
  list: adminProcedure.query(() => withConnection(listBatches)),
  detail: adminProcedure
    .input(z.number().int().positive())
    .query(({ input }) => withConnection(c => productionSummary(c, input))),
  save: adminProcedure
    .input(batchEditSchema)
    .mutation(({ input, ctx }) =>
      withConnection(c => saveBatch(c, input, ctx.user.id))
    ),
  associate: adminProcedure
    .input(batchAssignmentSchema)
    .mutation(({ input, ctx }) =>
      withConnection(c => assignBatchProducts(c, input, ctx.user.id))
    ),
  transition: adminProcedure
    .input(batchTransitionSchema)
    .mutation(({ input, ctx }) =>
      withConnection(c => transitionBatch(c, input, ctx.user.id))
    ),
});
