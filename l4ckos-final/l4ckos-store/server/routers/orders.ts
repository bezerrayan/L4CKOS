import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  claimPaymentCreation,
  completePaymentCreation,
  createCheckoutOrderAtomically,
  getCheckoutByAttempt,
  getProductsByIds,
  getProductVariantsByIds,
  getPaymentById,
  getOrderByIdAndUser,
  getOrderReservationItems,
  getOrderByTrackingCodeAndUser,
  getOrdersByUserId,
  getApplicableCouponByCode,
  markPaymentCreationUnknown,
  releaseExpiredStockReservations,
  updateUserAsaasCustomerId,
  updateOrderShippingAddress,
} from "../db";
import { createAsaasChargeForOrder } from "../services/asaas";
import { quoteShippingDetailed } from "../services/shippingService";
import { listAsaasPaymentsByExternalReference } from "../services/asaasService";
import { buildCheckoutFingerprint } from "../services/checkoutIntegrity";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import { sendOrderCreatedEmail, sendPaymentPendingEmail } from "../services/emailService.js";
import { securityLog } from "../_core/security";
import { getCheckoutAvailability } from "../_core/operationalConfig";

const checkoutItemSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  quantity: z.number().int().positive().max(99),
});

const shippingSelectionSchema = z.object({
  cep: z.string().trim().regex(/^\d{8}$/),
  optionId: z.string().trim().min(1).max(120),
});

const shippingAddressSchema = z.object({
  recipient: z.string().trim().min(3).max(255),
  zipCode: z.string().trim().regex(/^\d{8}$/),
  street: z.string().trim().min(2).max(255),
  number: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(255).optional(),
  neighborhood: z.string().trim().min(2).max(255),
  city: z.string().trim().min(2).max(255),
  state: z.string().trim().min(2).max(100),
});

const shippingAddressEditableSchema = z.object({
  recipient: z.string().trim().min(3).max(255),
  street: z.string().trim().min(2).max(255),
  number: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(255).optional(),
  neighborhood: z.string().trim().min(2).max(255),
});

async function resolveOrderPricing(input: {
  items: Array<{ productId: number; variantId?: number | null; quantity: number }>;
  shipping: { cep: string; optionId: string };
  couponCode?: string;
}) {
  const productIds = input.items.map(item => item.productId);
  const variantIds = input.items.map(item => item.variantId).filter((id): id is number => Boolean(id));
  const [products, variants] = await Promise.all([getProductsByIds(productIds), getProductVariantsByIds(variantIds)]);
  const productsById = new Map(products.map(product => [product.id, product]));
  const variantsById = new Map(variants.map(variant => [variant.id, variant]));

  let itemsSubtotalCents = 0;
  for (const item of input.items) {
    const product = productsById.get(item.productId);
    if (!product) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Produto ${item.productId} não encontrado` });
    }

    const variant = item.variantId ? variantsById.get(item.variantId) : undefined;
    if (item.variantId && (!variant || variant.productId !== product.id)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Variante inválida para ${product.name}` });
    }
    if (Number(variant?.stock ?? product.stock ?? 0) < item.quantity) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Estoque insuficiente para ${product.name}` });
    }

    itemsSubtotalCents += Number(variant?.price ?? product.price) * item.quantity;
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
      price: formatCurrency((Number((item.variantId ? variantsById.get(item.variantId)?.price : null) ?? productsById.get(item.productId)?.price ?? 0) * item.quantity) / 100),
    })),
    itemsSubtotalCents,
    shippingCents,
    grossTotalCents,
    discountCents,
    finalTotalCents: Math.max(0, grossTotalCents - discountCents),
    appliedCouponId,
    shippingOption,
    description: `${description || "Pedido Loja Escoteira"} | Frete: ${shippingOption.label}`,
  };
}

async function syncOrderPaymentIfNeeded(order: Awaited<ReturnType<typeof getOrderByIdAndUser>>) {
  return order;
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

      if (!["awaiting_payment", "ready"].includes(String(syncedOrder.fulfillmentStatus)) || syncedOrder.fulfillmentIssue) {
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
      }),
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
      }),
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
        }),
        couponCode: z.string().trim().min(2).max(64).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const availability = getCheckoutAvailability();
      if (!availability.available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: availability.message });
      }
      let orderId = 0;
      let claimedPaymentId: number | null = null;

      try {
        const checkoutFingerprint = buildCheckoutFingerprint({
          userId: ctx.user.id,
          method: input.method,
          items: input.items,
          shipping: input.shipping,
          shippingAddress: input.shippingAddress,
          couponCode: input.couponCode,
        });
        const existingCheckout = await getCheckoutByAttempt(input.checkoutAttemptId, ctx.user.id);
        if (existingCheckout && existingCheckout.order.checkoutFingerprint !== checkoutFingerprint) {
          throw new Error("CHECKOUT_IDEMPOTENCY_CONFLICT");
        }

        await releaseExpiredStockReservations();

        const previewPricing = existingCheckout
          ? {
              shippingCents: 0,
              shippingOption: { label: "Frete já registrado no pedido" },
              itemsPreview: (await getOrderReservationItems(existingCheckout.order.id)).map(item => ({
                name: item.productName || `Produto #${item.productId}`,
                quantity: item.quantity,
                price: formatCurrency(Number(item.totalPrice ?? item.unitPrice * item.quantity) / 100),
              })),
            }
          : await resolveOrderPricing({
              items: input.items,
              shipping: input.shipping,
              couponCode: input.couponCode,
            });

        const checkout = await createCheckoutOrderAtomically({
          userId: ctx.user.id,
          checkoutAttemptId: input.checkoutAttemptId,
          checkoutFingerprint,
          method: input.method,
          items: input.items,
          shippingCents: previewPricing.shippingCents,
          couponCode: input.couponCode,
          shippingAddress: input.shippingAddress,
        });
        orderId = checkout.order.id;
        let ledgerPayment = checkout.payment;
        if (!ledgerPayment) throw new Error("PAYMENT_LEDGER_NOT_FOUND");

        const paymentResponse = () => ({
          method: input.method,
          customerId: ledgerPayment?.providerCustomerId ?? null,
          paymentId: ledgerPayment?.providerPaymentId ?? null,
          invoiceUrl: ledgerPayment?.invoiceUrl ?? null,
          pixQrCode: ledgerPayment?.pixQrCode ?? null,
          pixCopyPaste: ledgerPayment?.pixCopyPaste ?? null,
          bankSlipUrl: ledgerPayment?.bankSlipUrl ?? null,
          digitableLine: ledgerPayment?.digitableLine ?? null,
          billingType: ledgerPayment?.billingType ?? input.method,
        });

        if (ledgerPayment.creationStatus === "created" && ledgerPayment.providerPaymentId) {
          return { orderId, ...paymentResponse(), reused: true };
        }

        const claimed = await claimPaymentCreation(ledgerPayment.id);
        if (!claimed) {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 250));
            ledgerPayment = await getPaymentById(ledgerPayment.id);
            if (ledgerPayment?.creationStatus === "created" && ledgerPayment.providerPaymentId) {
              return { orderId, ...paymentResponse(), reused: true };
            }
          }
          throw new Error("PAYMENT_CREATION_IN_PROGRESS");
        }
        claimedPaymentId = ledgerPayment.id;

        let payment: Awaited<ReturnType<typeof createAsaasChargeForOrder>>;
        const reconciliationCandidates = await listAsaasPaymentsByExternalReference(ledgerPayment.externalReference);
        const matchingCandidates = reconciliationCandidates.filter(candidate =>
          candidate.value === null || candidate.value === undefined || Math.round(Number(candidate.value) * 100) === ledgerPayment!.amount,
        );
        if (reconciliationCandidates.length > 0 && matchingCandidates.length === 0) {
          throw new Error("ASAAS_RECONCILIATION_AMOUNT_MISMATCH");
        }
        if (matchingCandidates.length > 1) {
          throw new Error("ASAAS_DUPLICATE_PAYMENTS_FOR_REFERENCE");
        }
        const reconciled = matchingCandidates[0];
        if (reconciled?.id) {
          payment = {
            method: input.method,
            customerId: reconciled.customer ?? ledgerPayment.providerCustomerId ?? "",
            paymentId: reconciled.id,
            invoiceUrl: reconciled.invoiceUrl ?? null,
            pixQrCode: null,
            pixCopyPaste: null,
            bankSlipUrl: reconciled.bankSlipUrl ?? null,
            digitableLine: reconciled.identificationField ?? null,
            nossoNumero: null,
            billingType: reconciled.billingType ?? null,
          };
        } else {
          payment = await createAsaasChargeForOrder({
            orderId,
            method: input.method,
            value: Number((ledgerPayment.amount / 100).toFixed(2)),
            description: `Pedido #${orderId} | Frete: ${previewPricing.shippingOption.label}`,
            dueDate: input.dueDate,
            externalReference: ledgerPayment.externalReference,
            customerId: ctx.user.asaasCustomerId ?? undefined,
            customer: {
              name: input.customer.name,
              cpfCnpj: input.customer.cpfCnpj,
              email: input.customer.email || ctx.user.email || undefined,
            },
          });
        }

        await completePaymentCreation(ledgerPayment.id, {
          providerPaymentId: payment.paymentId,
          providerCustomerId: payment.customerId,
          billingType: payment.billingType,
          invoiceUrl: payment.invoiceUrl,
          bankSlipUrl: payment.bankSlipUrl,
          pixQrCode: payment.pixQrCode,
          pixCopyPaste: payment.pixCopyPaste,
          digitableLine: payment.digitableLine,
        });
        claimedPaymentId = null;
        if (!ctx.user.asaasCustomerId && payment.customerId) {
          await updateUserAsaasCustomerId(ctx.user.id, payment.customerId);
        }

        const formattedTotal = formatCurrency(ledgerPayment.amount / 100);
        try {
          await sendOrderCreatedEmail({
            customerEmail: input.customer.email || ctx.user.email || "",
            customerName: input.customer.name,
            orderNumber: String(orderId),
            total: formattedTotal,
            items: previewPricing.itemsPreview,
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
          reused: checkout.reused,
        };
      } catch (error) {
        if (claimedPaymentId) {
          await markPaymentCreationUnknown(claimedPaymentId);
        }
        securityLog("warn", "orders.asaas_charge_failed", {
          userId: ctx.user.id,
          orderId: orderId || undefined,
          reason: error instanceof Error ? error.message : "unknown",
        });
        const reason = error instanceof Error ? error.message : "unknown";
        if (reason === "CHECKOUT_IDEMPOTENCY_CONFLICT") {
          throw new TRPCError({ code: "CONFLICT", message: "Esta tentativa de checkout já foi usada com outros dados." });
        }
        if (reason.includes("INSUFFICIENT_")) {
          throw new TRPCError({ code: "CONFLICT", message: "O estoque mudou durante a compra. Revise o carrinho." });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: "Não foi possível gerar a cobrança agora. Tente novamente com a mesma tentativa." });
      }
    }),
});
