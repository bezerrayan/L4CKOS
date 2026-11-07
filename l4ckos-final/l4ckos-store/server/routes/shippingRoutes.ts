import { Router } from "express";
import { createConnection } from "mysql2/promise";
import { createMysqlConnectionOptions } from "../database/mysqlTls.mjs";
import { z } from "zod";
import { checkoutItemSchema, previewCheckoutItems } from "../database/checkout";
import { quoteShippingDetailed } from "../services/shippingService";

const shippingRoutes = Router();

shippingRoutes.post("/quote", async (req, res) => {
  try {
    const input = z.object({
      cep: z.string().trim().regex(/^\d{8}$/),
      items: z.array(checkoutItemSchema).min(1).max(99),
    }).strict().parse(req.body);
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ error: "Cotação indisponível." });
      return;
    }
    const connection = await createConnection({ ...createMysqlConnectionOptions(process.env.DATABASE_URL, process.env, { socketPath: process.env.L4CKOS_LOCAL_MYSQL_SOCKET }), timezone: "Z" });
    const products = await (async () => {
      try { return await previewCheckoutItems(connection, input.items); }
      finally { await connection.end(); }
    })();
    const result = await quoteShippingDetailed({
      cep: input.cep,
      items: products.map(item => ({
        key: item.sku?.trim() || `product:${item.productId}`,
        quantity: item.quantity,
        unitPriceCents: item.unitPrice,
      })),
      itemCount: products.reduce((count, item) => count + item.quantity, 0),
      subtotal: products.reduce((total, item) => total + item.totalPrice, 0) / 100,
    });

    if (result.providerError) {
      console.warn("[Shipping] Quote unavailable:", result.providerError);
    }

    res.json(result);
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 503;
    res.status(status).json({ error: status === 400 ? "Itens ou CEP inválidos." : "Não foi possível calcular o frete." });
  }
});

export default shippingRoutes;
