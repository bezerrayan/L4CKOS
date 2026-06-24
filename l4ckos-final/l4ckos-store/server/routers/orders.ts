import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  createOrderWithId,
  getProductsByIds,
  getOrderByIdAndUser,
  getOrderReservationItems,
  getOrderByTrackingCodeAndUser,
  getOrdersByUserId,
  getApplicableCouponByCode,
  incrementCouponUsage,
  markOrderPaid,
  reserveStockForOrder,
  updateOrderShippingAddress,
} from "../db";
import { createAsaasChargeForOrder } from "../services/asaas";
import { quoteShippingDetailed } from "../services/shippingService";
import { listAsaasPaymentsByExternalReference } from "../services/asaasService";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import { sendOrderCreatedEmail, sendPaymentPendingEmail } from "../services/emailService.js";
import { securityLog } from "../_core/security";

const checkoutItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(99),
}).strict();

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
  items: Array<{ productId: number; quantity: number }>;
  shipping: { cep: string; optionId: string };
  couponCode?: string;
}) {
  const productIds = input.items.map(item => item.productId);
  const products = await getProductsByIds(productIds);
  const productsById = new Map(products.map(product => [product.id, product]));

  let itemsSubtotalCents = 0;
  for (const item of input.items) {
    const product = productsById.get(item.productId);
    if (!product) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Produto ${item.productId} não encontrado` });
    }

    if (Number(product.stock ?? 0) < item.quantity) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Estoque insuficiente para ${product.name}` });
    }

    itemsSubtotalCents += Number(product.price) * item.quantity;
  }

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
  const grossTotalCents = itemsSubtotalCents + shippingCents;

  let appliedCouponId: number | null = null;
  let discountCents = 0;
  if (input.couponCode) {
    const coupon = await getApplicableCouponByCode(input.couponCode);
    if (!coupon) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Cupom inválido ou expirado" });
    }

    const grossTotal = grossTotalCents / 100;
    const rawDiscount =
      coupon.type === "percent"
        ? Number(((grossTotal * coupon.value) / 100).toFixed(2))
        : Number(coupon.value.toFixed(2));

    discountCents = Math.min(grossTotalCents, Math.round(rawDiscount * 100));
    appliedCouponId = coupon.id;
  }

  const description = input.items
    .slice(0, 2)
    .map(item => productsById.get(item.productId)?.name)
    .filter(Boolean)
    .join(" + ");

  return {
    itemsPreview: input.items.map(item => ({
      name: productsById.get(item.productId)?.name || `Produto #${item.productId}`,
      quantity: item.quantity,
      price: formatCurrency((Number(productsById.get(item.productId)?.price || 0) * item.quantity) / 100),
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

const ASAAS_PAID_STATUSES = new Set([
  "RECEIVED",
  "CONFIRMED",
  "RECEIVED_IN_CASH",
  "REFUNDED_PARTIALLY",
]);

async function syncOrderPaymentIfNeeded(order: Awaited<ReturnType<typeof getOrderByIdAndUser>>) {
  if (!order) return order;
  if (!["pending", "processing"].includes(String(order.status))) {
    return order;
  }

  try {
    const payments = await listAsaasPaymentsByExternalReference(String(order.id));
    const hasPaidPayment = payments.some(payment => ASAAS_PAID_STATUSES.has(String(payment.status ?? "").toUpperCase()));

    if (!hasPaidPayment) {
      return order;
    }

    await markOrderPaid(order.id);
    const refreshed = await getOrderByIdAndUser(order.id, order.userId);
    return refreshed ?? order;
  } catch {
    return order;
  }
}

export const ordersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const orders = await getOrdersByUserId(ctx.user.id);
    const syncedOrders = await Promise.all(orders.map(order => syncOrderPaymentIfNeeded(order)));
    return syncedOrders;
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

      const syncedOrder = await syncOrderPaymentIfNeeded(order);

      if (!syncedOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pedido não encontrado para este usuário",
        });
      }

      const items = await getOrderReservationItems(syncedOrder.id);
      return { ...syncedOrder, items };
    }),

  detail: protectedProcedure.input(z.number().int().positive()).query(async ({ input, ctx }) => {
    const order = await getOrderByIdAndUser(input, ctx.user.id);
    const syncedOrder = await syncOrderPaymentIfNeeded(order);
    if (!syncedOrder) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Pedido não encontrado para este usuário",
      });
    }

    const items = await getOrderReservationItems(syncedOrder.id);
    return { ...syncedOrder, items };
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
      const syncedOrder = await syncOrderPaymentIfNeeded(order);

      if (!syncedOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pedido não encontrado para este usuário",
        });
      }

      if (!["pending", "paid"].includes(String(syncedOrder.status))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "O endereço só pode ser ajustado antes do pedido entrar em separação.",
        });
      }

      await updateOrderShippingAddress(syncedOrder.id, {
        recipient: input.address.recipient,
        street: input.address.street,
        number: input.address.number,
        complement: input.address.complement,
        neighborhood: input.address.neighborhood,
      });

      const updatedOrder = await getOrderByIdAndUser(syncedOrder.id, ctx.user.id);
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
        const pricing = await resolveOrderPricing({
          items: input.items,
          shipping: input.shipping,
          couponCode: input.couponCode,
        });

        orderId = await createOrderWithId(ctx.user.id, pricing.finalTotalCents, {
          recipient: input.shippingAddress.recipient,
          zipCode: input.shippingAddress.zipCode,
          street: input.shippingAddress.street,
          number: input.shippingAddress.number,
          complement: input.shippingAddress.complement,
          neighborhood: input.shippingAddress.neighborhood,
          city: input.shippingAddress.city,
          state: input.shippingAddress.state,
        });
        await reserveStockForOrder({
          userId: ctx.user.id,
          orderId,
          items: input.items,
        });

        const payment = await createAsaasChargeForOrder({
          orderId,
          method: input.method,
          value: Number((pricing.finalTotalCents / 100).toFixed(2)),
          description: pricing.description,
          dueDate: input.dueDate,
          customer: {
            name: input.customer.name,
            cpfCnpj: input.customer.cpfCnpj,
            email: input.customer.email || ctx.user.email || undefined,
          },
        });

        if (pricing.appliedCouponId) {
          await incrementCouponUsage(pricing.appliedCouponId);
        }

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
          reason: error instanceof Error ? error.message : "unknown",
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Não foi possível gerar a cobrança agora.",
        });
      }
    }),
});
