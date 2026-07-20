import { z } from "zod";

export const reviewCommentSchema = z
  .string()
  .trim()
  .min(10, "Conte um pouco mais sobre sua experiência.")
  .max(1000, "O comentário deve ter no máximo 1000 caracteres.")
  .refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value), {
    message: "O comentário contém caracteres inválidos.",
  });

export const createReviewInputSchema = z.object({
  productId: z.number().int().positive(),
  stockReservationId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  comment: reviewCommentSchema,
  sizePerception: z.enum(["small", "true_to_size", "large"]),
  imageToken: z.string().uuid().optional(),
}).strict();

export const reviewModerationInputSchema = z
  .object({
    reviewId: z.number().int().positive(),
    moderationStatus: z.enum(["published", "hidden_spam", "hidden_offensive"]).optional(),
    imageStatus: z.enum(["approved", "rejected"]).optional(),
  })
  .strict()
  .refine(value => Boolean(value.moderationStatus || value.imageStatus), {
    message: "Informe uma ação de moderação.",
  });
