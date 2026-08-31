import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getCheckoutAvailability, getOperationalConfig } from "./operationalConfig";
import { getRuntimeMetadata } from "./runtime";

export const systemRouter = router({
  runtime: publicProcedure.query(() => {
    const operational = getOperationalConfig();
    return {
      ...getRuntimeMetadata(),
      checkout: getCheckoutAvailability(),
      maintenanceMode: operational.maintenanceMode,
    };
  }),
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
