import { shippingEstimate } from "../../shared/preorder";
import { createConnection } from "mysql2/promise";
import { checkout, checkoutItemSchema, CheckoutError, previewCheckoutItems, orderTotal, type CheckoutItem } from "../database/checkout";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  getOrderByIdAndUser,
  getOrderReservationItems,
  getOrderByTrackingCodeAndUser,
  getOrdersByUserId,
  getApplicableCouponByCode,
  updateOrderShippingAddress,
} from "../db";
import { createAsaasChargeForOrder } from "../services/asaas";
import { quoteShippingDetailed } from "../services/shippingService";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import { sendOrderCreatedEmail, sendPaymentPendingEmail } from "../services/emailService.js";
import { securityLog } from "../_core/security";

const shippingSelectionSchema = z.object({
  cep: z.string().trim().regex(/^\d{8}$/),
  optionId: z.string().trim().min(1).max(120),
}).strict();

const shippingAddressSchema = z.object({
  recipient: z.string().trim().min(3).max(255),
  zipCode: z.string().trim().regex(/^\d{8}$/),
  street: z.string().trim().min(2).max(255),
  number: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(255).optional(),
  neighborhood: z.string().trim().min(2).max(255),
  city: z.string().trim().min(2).max(255),
  state: z.string().trim().min(2).max(100),
}).strict();

const shippingAddressEditableSchema = z.object({
  recipient: z.string().trim().min(3).max(255),
  street: z.string().trim().min(2).max(255),
  number: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(255).optional(),
  neighborhood: z.string().trim().min(2).max(255),
}).strict();

async function resolveOrderPricing(input: {
  items: CheckoutItem[];
  shipping: { cep: string; optionId: string };
  couponCode?: string;
}) {
  if (!process.env.DATABASE_URL) throw new CheckoutError("CHECKOUT_DATABASE_REQUIRED");
  const connection = await createConnection({ uri: process.env.DATABASE_URL, timezone: "Z", socketPath: process.env.L4CKOS_LOCAL_MYSQL_SOCKET });
  const frozen = await (async () => {
    try { return await previewCheckoutItems(connection,input.items); }
    finally { await connection.end(); }
  })();
  const itemsSubtotalCents = frozen.reduce((sum,item)=>sum+item.totalPrice,0);
  orderTotal(itemsSubtotalCents,0);

  const shippingQuote = await quoteShippingDetailed({
    cep: input.shipping.cep,
    itemCount: input.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: Number((itemsSubtotalCents / 100).toFixed(2)),
  });

  const shippingOption = shippingQuote.options.find(option => option.id === input.shipping.optionId);
  if (!shippingOption) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Opção de frete inválida" });
  }

  const shippingCents = Math.round(Number(shippingOption.price) * 100);
  const grossTotalCents = orderTotal(itemsSubtotalCents,shippingCents).totalPrice;

  let appliedCouponId: number | null = null;
  let discountCents = 0;
  if (input.couponCode) {
    const coupon = await getApplicableCouponByCode(input.couponCode);
    if (!coupon) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Cupom inválido ou expirado" });
    }

    discountCents = orderTotal(itemsSubtotalCents,shippingCents,coupon).discountCents;
    appliedCouponId = coupon.id;
  }

  const description = frozen
    .slice(0, 2)
    .map(item => item.productName)
    .filter(Boolean)
    .join(" + ");

  return {
    itemsPreview: frozen.map(item => ({
      name: item.salesModeAtPurchase === "PREORDER" ? `${item.productName} — Pré-venda — ${item.productionBatchNameAtPurchase}. ${shippingEstimate(item.estimatedShippingStartAtPurchase,item.estimatedShippingEndAtPurchase)}` : item.productName,
      quantity: item.quantity,
      price: formatCurrency(item.totalPrice / 100),
    })),
    itemsSubtotalCents,
    shippingCents,
    grossTotalCents,
    discountCents,
    finalTotalCents: Math.max(0, grossTotalCents - discountCents),
    appliedCouponId,
    shippingOption,
    description: `${description || "Pedido L4CKOS"} | Frete: ${shippingOption.label}`,
  };
}

export const ordersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await getOrdersByUserId(ctx.user.id);
  }),

  track: protectedProcedure
    .input(
      z
        .object({
          orderId: z.number().int().positive().optional(),
          trackingCode: z.string().trim().min(3).max(120).optional(),
        })
        .refine(data => data.orderId || data.trackingCode, {
          message: "Informe o número do pedido ou código de rastreio",
        }),
    )
    .query(async ({ input, ctx }) => {
      const order = input.orderId
        ? await getOrderByIdAndUser(input.orderId, ctx.user.id)
        : await getOrderByTrackingCodeAndUser(input.trackingCode ?? "", ctx.user.id);

      if (!order) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pedido não encontrado para este usuário",
        });
      }

      const items = await getOrderReservationItems(order.id);
      return { ...order, items };
    }),

  detail: protectedProcedure.input(z.number().int().positive()).query(async ({ input, ctx }) => {
    const order = await getOrderByIdAndUser(input, ctx.user.id);
    if (!order) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Pedido não encontrado para este usuário",
      });
    }

    const items = await getOrderReservationItems(order.id);
    return { ...order, items };
  }),

  updateShippingAddress: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int().positive(),
        address: shippingAddressEditableSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const order = await getOrderByIdAndUser(input.orderId, ctx.user.id);
      if (!order) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pedido não encontrado para este usuário",
        });
      }

      if (!["pending", "paid"].includes(String(order.status))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "O endereço só pode ser ajustado antes do pedido entrar em separação.",
        });
      }

      await updateOrderShippingAddress(order.id, {
        recipient: input.address.recipient,
        street: input.address.street,
        number: input.address.number,
        complement: input.address.complement,
        neighborhood: input.address.neighborhood,
      });

      const updatedOrder = await getOrderByIdAndUser(order.id, ctx.user.id);
      if (!updatedOrder) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível carregar o pedido atualizado.",
        });
      }

      return updatedOrder;
    }),

  create: protectedProcedure
    .input(
      z.object({
        totalPrice: z.number().positive(),
      }).strict(),
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Este fluxo de criação direta foi desativado por segurança. Use o checkout protegido.",
      });
    }),

  validateCoupon: protectedProcedure
    .input(
      z.object({
        code: z.string().trim().min(2).max(64),
        items: z.array(checkoutItemSchema).min(1),
        shipping: shippingSelectionSchema,
      }).strict(),
    )
    .mutation(async ({ input }) => {
      const pricing = await resolveOrderPricing({
        items: input.items,
        shipping: input.shipping,
        couponCode: input.code,
      });

      const coupon = await getApplicableCouponByCode(input.code);
      if (!coupon) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cupom inválido ou expirado" });
      }

      return {
        couponId: coupon.id,
        code: coupon.code,
        type: coupon.type,
        discountAmount: Number((pricing.discountCents / 100).toFixed(2)),
        finalTotal: Number((pricing.finalTotalCents / 100).toFixed(2)),
      } as const;
    }),

  createAsaasCharge: protectedProcedure
    .input(
      z.object({
        checkoutAttemptId: z.string().uuid(),
        method: z.enum(["PIX", "BOLETO", "CARD"]),
        items: z.array(checkoutItemSchema).min(1),
        shipping: shippingSelectionSchema,
        shippingAddress: shippingAddressSchema,
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        customer: z.object({
          name: z.string().min(3).max(255),
          cpfCnpj: z
            .string()
            .min(11)
            .max(18)
            .transform(value => value.replace(/\D/g, ""))
            .refine(value => value.length === 11 || value.length === 14, "Invalid CPF/CNPJ"),
          email: z.string().email().optional(),
        }).strict(),
        couponCode: z.string().trim().min(2).max(64).optional(),
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      let orderId = 0;

      try {
        if (!process.env.DATABASE_URL) throw new CheckoutError("CHECKOUT_DATABASE_REQUIRED");
        const connection = await createConnection({ uri: process.env.DATABASE_URL, timezone: "Z", socketPath: process.env.L4CKOS_LOCAL_MYSQL_SOCKET });
        const prepared = await (async () => {
          try { return await checkout(connection, { ...input, userId: ctx.user.id,
            customer: { ...input.customer, email: input.customer.email || ctx.user.email || undefined },
          }, { quote: quoteShippingDetailed, charge: createAsaasChargeForOrder }); }
          finally { await connection.end(); }
        })();
        orderId = prepared.orderId;
        const payment = prepared.payment;
        if (prepared.replayed) return { orderId, ...payment };
        const pricing = { finalTotalCents: prepared.totalPrice, itemsPreview: prepared.items.map(item => ({
          name: item.salesModeAtPurchase === "PREORDER" ? `${item.productName} — Pré-venda — ${item.productionBatchNameAtPurchase}. ${shippingEstimate(item.estimatedShippingStartAtPurchase,item.estimatedShippingEndAtPurchase)}` : item.productName, quantity: item.quantity, price: formatCurrency(item.totalPrice / 100),
        })) };

        const formattedTotal = formatCurrency(pricing.finalTotalCents / 100);
        try {
          await sendOrderCreatedEmail({
            customerEmail: input.customer.email || ctx.user.email || "",
            customerName: input.customer.name,
            orderNumber: String(orderId),
            total: formattedTotal,
            items: pricing.itemsPreview,
            orderUrl: `${String(process.env.APP_URL || process.env.APP_BASE_URL || process.env.FRONTEND_URL || "https://l4ckos.com.br").replace(/\/$/, "")}/meus-pedidos/${orderId}`,
          });
        } catch {}

        try {
          await sendPaymentPendingEmail({
            customerEmail: input.customer.email || ctx.user.email || "",
            customerName: input.customer.name,
            orderNumber: String(orderId),
            total: formattedTotal,
            paymentUrl: payment.invoiceUrl || payment.bankSlipUrl || undefined,
            dueLabel: input.dueDate || "Aguardando compensação",
          });
        } catch {}

        return {
          orderId,
          ...payment,
        };
      } catch (error) {
        securityLog("warn", "orders.asaas_charge_failed", {
          userId: ctx.user.id,
          orderId: orderId || undefined,
          reason: error instanceof CheckoutError ? error.code : "CHECKOUT_FAILED",
        });
        const checkoutCode = error instanceof CheckoutError ? error.code : "";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            checkoutCode === "CHECKOUT_BATCH_CAPACITY_EXCEEDED"
            ? "A capacidade da pré-venda foi esgotada. Ajuste a sacola e tente novamente."
            : checkoutCode === "CHECKOUT_BATCH_UNAVAILABLE"
                ? "Esta pré-venda não está mais disponível. Ajuste a sacola e tente novamente."
                : checkoutCode === "CHECKOUT_RECOVERY_REQUIRED"
                  ? "Tentativa registrada; o resultado da cobrança precisa ser verificado antes de tentar novamente."
                  : "Não foi possível gerar a cobrança agora.",
        });
      }
    }),
});
