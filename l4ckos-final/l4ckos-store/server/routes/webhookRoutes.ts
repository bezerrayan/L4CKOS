import { Router } from "express";
import { asaasWebhookHandler } from "../controllers/paymentController";

const webhookRoutes = Router();

webhookRoutes.post("/asaas", asaasWebhookHandler);
webhookRoutes.all("/asaas", (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed", status: 405 });
});

export default webhookRoutes;
