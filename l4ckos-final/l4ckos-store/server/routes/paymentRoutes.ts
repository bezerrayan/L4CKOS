import { Router } from "express";
import { createCheckoutHandler, createCustomerHandler } from "../controllers/paymentController";
import { requireAuthenticatedUser } from "../_core/httpAuth";

const paymentRoutes = Router();

paymentRoutes.post("/create-customer", requireAuthenticatedUser, createCustomerHandler);
paymentRoutes.post("/create-checkout", requireAuthenticatedUser, createCheckoutHandler);
paymentRoutes.all("/create-customer", (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed", status: 405 });
});
paymentRoutes.all("/create-checkout", (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed", status: 405 });
});

export default paymentRoutes;
