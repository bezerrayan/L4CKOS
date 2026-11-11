import { Router } from "express";
import { quoteShippingDetailed } from "../services/shippingService";
import type { QuoteShippingResult } from "../services/shippingService";

const shippingRoutes = Router();

/** Provider diagnostics can include upstream response content; keep them server-private. */
export function toPublicShippingQuote(result: QuoteShippingResult) {
  const { providerError: _providerError, ...safeResult } = result;
  return {
    ...safeResult,
    options: safeResult.options.filter(
      option =>
        Number.isFinite(option.price) &&
        option.price >= 0 &&
        Boolean(option.id.trim())
    ),
  };
}

shippingRoutes.post("/quote", async (req, res) => {
  const cep = String(req.body?.cep || "").replace(/\D/g, "");
  const itemCount = Number(req.body?.itemCount);
  const subtotal = Number(req.body?.subtotal);
  if (!/^\d{8}$/.test(cep)) {
    res.status(400).json({ error: "CEP inválido" });
    return;
  }
  if (
    !Number.isSafeInteger(itemCount) ||
    itemCount < 1 ||
    itemCount > 3_000 ||
    !Number.isFinite(subtotal) ||
    subtotal < 0 ||
    subtotal > 21_474_836.47
  ) {
    res.status(400).json({ error: "Dados de frete inválidos" });
    return;
  }

  try {
    const result = await quoteShippingDetailed({
      cep,
      itemCount,
      subtotal,
    });

    // Log only outcome metadata. Never log or return the upstream response body.
    console.info("[Shipping] quote completed", {
      source: result.source,
      optionCount: result.options.length,
    });
    res.json(toPublicShippingQuote(result));
  } catch (error) {
    console.warn("[Shipping] quote failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(503).json({ error: "Não foi possível consultar o frete agora" });
  }
});

export default shippingRoutes;
