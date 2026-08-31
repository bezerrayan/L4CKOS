import { getResendClient } from "./resendClient.js";
import { renderEmailTemplate } from "./emailRenderer.js";
import { emailSubjects } from "../../utils/email/emailSubjects.js";
import { buildUnsubscribeUrl, ensureMarketingAllowed } from "./emailSubscriptions.js";
import { renderToStaticMarkup } from "react-dom/server";
import { securityLog } from "../../_core/security";

function sanitizeText(value) {
  return String(value ?? "").trim();
}

function sanitizeEmail(value) {
  return sanitizeText(value).toLowerCase();
}

function assertStagingRecipientsAllowed(recipients) {
  const environment = sanitizeText(process.env.APP_ENV || process.env.DEPLOY_ENV).toLowerCase();
  const inferredStaging = sanitizeText(process.env.VERCEL_ENV).toLowerCase() === "preview"
    || /^(staging|stage|hml|homolog|homologation)$/i.test(sanitizeText(process.env.RAILWAY_ENVIRONMENT_NAME));
  if (environment !== "staging" && !inferredStaging) return;

  const allowed = new Set(
    sanitizeText(process.env.STAGING_EMAIL_ALLOWLIST)
      .split(",")
      .map(sanitizeEmail)
      .filter(Boolean),
  );
  const blocked = recipients.map(sanitizeEmail).filter(email => !allowed.has(email));
  if (blocked.length > 0) {
    const error = new Error("Staging email recipient is not allowlisted");
    error.name = "StagingEmailRecipientBlocked";
    throw error;
  }
}

function resolveAppUrl() {
  return (
    sanitizeText(process.env.APP_URL) ||
    sanitizeText(process.env.APP_BASE_URL) ||
    sanitizeText(process.env.FRONTEND_URL) ||
    "https://l4ckos.com.br"
  ).replace(/\/$/, "");
}

function requireEmailConfig(name, fallbacks = []) {
  for (const key of [name, ...fallbacks]) {
    const value = sanitizeText(process.env[key]);
    if (value) return value;
  }
  throw new Error(`Missing env var: ${name}`);
}

function getDefaultReplyTo() {
  return (
    sanitizeText(process.env.EMAIL_REPLY_TO) ||
    sanitizeText(process.env.SUPPORT_EMAIL) ||
    sanitizeText(process.env.EMAIL_FROM_CONTACT) ||
    sanitizeText(process.env.EMAIL_FROM)
  );
}

function getAlertsRecipient() {
  return (
    sanitizeText(process.env.ALERTS_NOTIFICATION_EMAIL) ||
    sanitizeText(process.env.ORDERS_ALERT_EMAIL) ||
    sanitizeText(process.env.EMAIL_TO_SALES) ||
    sanitizeText(process.env.EMAIL_TO_FINANCE) ||
    sanitizeText(process.env.EMAIL_TO_CONTACT)
  );
}

function buildSubject(subjectKey, payload) {
  const entry = emailSubjects[subjectKey];
  if (!entry) throw new Error(`Unknown email subject key: ${subjectKey}`);
  return typeof entry === "function" ? entry(payload ?? {}) : entry;
}

async function sendEmail({ templateName, subjectKey, subjectPayload, templatePayload, from, to, replyTo, tags }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(sanitizeText).filter(Boolean);
  if (!recipients.length) {
    throw new Error("Email recipients are required");
  }
  try {
    assertStagingRecipientsAllowed(recipients);
  } catch (error) {
    if (error instanceof Error && error.name === "StagingEmailRecipientBlocked") {
      securityLog("warn", "email.staging_recipient_blocked", {
        templateName,
        recipientCount: recipients.length,
      });
      return { skipped: true, reason: "not_allowlisted" };
    }
    throw error;
  }

  const environment = sanitizeText(process.env.APP_ENV || process.env.DEPLOY_ENV).toLowerCase();
  const subjectPrefix = environment === "staging" ? "[STAGING] " : "";
  const subject = `${subjectPrefix}${buildSubject(subjectKey, subjectPayload)}`;
  const react = renderEmailTemplate(templateName, templatePayload);
  const html = `<!doctype html>${renderToStaticMarkup(react)}`;
  const payload = {
    from,
    to: recipients,
    subject,
    html,
    tags,
  };

  if (replyTo) payload.replyTo = replyTo;

  const client = getResendClient();
  const { data, error } = await client.emails.send(payload);
  if (error) {
    const err = new Error(error.message || "Resend request failed");
    err.name = "ResendError";
    throw err;
  }

  console.info("[Email] sent", {
    templateName,
    subject,
    to: recipients,
    emailId: data?.id ?? null,
  });

  return data;
}

async function sendMarketingEmail({ templateName, subjectKey, subjectPayload, templatePayload, email, from, replyTo, tags }) {
  const normalizedEmail = sanitizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Marketing email recipient is required");
  }

  const allowed = await ensureMarketingAllowed(normalizedEmail);
  if (!allowed) {
    return { skipped: true, reason: "unsubscribed" };
  }

  return sendEmail({
    templateName,
    subjectKey,
    subjectPayload,
    templatePayload: {
      ...templatePayload,
      unsubscribeUrl: buildUnsubscribeUrl(normalizedEmail),
    },
    from: from || requireEmailConfig("EMAIL_FROM_MARKETING", ["EMAIL_FROM_NOREPLY", "EMAIL_FROM"]),
    to: normalizedEmail,
    replyTo: replyTo || getDefaultReplyTo(),
    tags,
  });
}

function normalizeOrderItems(items = []) {
  return items.map(item => ({
    id: Number(item.id || item.productId || 0),
    name: sanitizeText(item.name || item.productName || "Produto"),
    quantity: Number(item.quantity || 1),
    price: sanitizeText(item.price || item.formattedPrice || ""),
  }));
}

function normalizeProducts(products = []) {
  return products.map(item => ({
    id: Number(item.id || item.productId || 0),
    name: sanitizeText(item.name || item.productName || "Produto"),
    price: sanitizeText(item.price || item.formattedPrice || ""),
    imageUrl: sanitizeText(item.imageUrl || item.productImage || ""),
    stock: item.stock === undefined || item.stock === null ? undefined : Number(item.stock),
  }));
}

function logEmailFailure(scope, error, context = {}) {
  console.error(`[Email] ${scope}`, {
    ...context,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

export async function sendComingSoonConfirmationEmail({ email, name, launchUrl }) {
  return sendEmail({
    templateName: "comingSoonConfirmation",
    subjectKey: "comingSoonConfirmation",
    templatePayload: { name, launchUrl: launchUrl || resolveAppUrl() },
    from: requireEmailConfig("NO_REPLY_EMAIL", ["EMAIL_FROM_NOREPLY", "EMAIL_FROM"]),
    to: sanitizeEmail(email),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendContactConfirmationEmail({ email, name }) {
  return sendEmail({
    templateName: "contactConfirmation",
    subjectKey: "contactConfirmation",
    templatePayload: { name },
    from: requireEmailConfig("NO_REPLY_EMAIL", ["EMAIL_FROM_NOREPLY", "EMAIL_FROM"]),
    to: sanitizeEmail(email),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendNewContactInternalEmail({ name, email, phone, subject, message }) {
  const to = sanitizeText(process.env.CONTACT_NOTIFICATION_EMAIL) || requireEmailConfig("EMAIL_TO_CONTACT", ["EMAIL_TO"]);
  return sendEmail({
    templateName: "newContactInternal",
    subjectKey: "newContactInternal",
    subjectPayload: { subject },
    templatePayload: { name, email, phone, subject, message },
    from: requireEmailConfig("EMAIL_FROM_CONTACT", ["EMAIL_FROM"]),
    to,
    replyTo: sanitizeEmail(email),
  });
}

export async function sendWelcomeAccountEmail({ email, name }) {
  return sendEmail({
    templateName: "welcomeAccount",
    subjectKey: "welcomeAccount",
    templatePayload: { name, appUrl: `${resolveAppUrl()}/login` },
    from: requireEmailConfig("NO_REPLY_EMAIL", ["EMAIL_FROM_NOREPLY", "EMAIL_FROM"]),
    to: sanitizeEmail(email),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendPasswordResetEmail({ email, name, resetUrl }) {
  return sendEmail({
    templateName: "passwordReset",
    subjectKey: "passwordReset",
    templatePayload: { name, resetUrl },
    from: requireEmailConfig("NO_REPLY_EMAIL", ["EMAIL_FROM_NOREPLY", "EMAIL_FROM"]),
    to: sanitizeEmail(email),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendOrderCreatedEmail({ customerEmail, customerName, orderNumber, total, items, orderUrl }) {
  return sendEmail({
    templateName: "orderCreated",
    subjectKey: "orderCreated",
    subjectPayload: { orderNumber },
    templatePayload: {
      customerName,
      orderNumber,
      total,
      items: normalizeOrderItems(items),
      orderUrl,
    },
    from: requireEmailConfig("ORDERS_EMAIL", ["EMAIL_FROM_SALES", "EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendPaymentPendingEmail({ customerEmail, customerName, orderNumber, total, paymentUrl, dueLabel }) {
  return sendEmail({
    templateName: "paymentPending",
    subjectKey: "paymentPending",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, orderNumber, total, paymentUrl, dueLabel },
    from: requireEmailConfig("EMAIL_FROM_FINANCE", ["EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendPaymentNotFinishedEmail({
  customerEmail,
  customerName,
  orderNumber,
  total,
  paymentUrl,
  recoveryWindowLabel,
}) {
  return sendEmail({
    templateName: "paymentNotFinished",
    subjectKey: "paymentNotFinished",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, orderNumber, total, paymentUrl, recoveryWindowLabel },
    from: requireEmailConfig("EMAIL_FROM_FINANCE", ["EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendPaymentApprovedEmail({ customerEmail, customerName, orderNumber, total }) {
  return sendEmail({
    templateName: "paymentApproved",
    subjectKey: "paymentApproved",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, orderNumber, total },
    from: requireEmailConfig("EMAIL_FROM_FINANCE", ["EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendPaymentFailedEmail({ customerEmail, customerName, orderNumber, total, paymentUrl, failureReason }) {
  return sendEmail({
    templateName: "paymentFailed",
    subjectKey: "paymentFailed",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, orderNumber, total, paymentUrl, failureReason },
    from: requireEmailConfig("EMAIL_FROM_FINANCE", ["EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendOrderPreparingEmail({ customerEmail, customerName, orderNumber, total }) {
  return sendEmail({
    templateName: "orderPreparing",
    subjectKey: "orderPreparing",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, orderNumber, total },
    from: requireEmailConfig("ORDERS_EMAIL", ["EMAIL_FROM_SALES", "EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendShippingEmail({ customerEmail, customerName, orderNumber, trackingCode, trackingUrl }) {
  return sendEmail({
    templateName: "orderShipped",
    subjectKey: "orderShipped",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, orderNumber, trackingCode, trackingUrl },
    from: requireEmailConfig("ORDERS_EMAIL", ["EMAIL_FROM_SALES", "EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendOrderDeliveredEmail({ customerEmail, customerName, orderNumber, orderUrl }) {
  return sendEmail({
    templateName: "orderDelivered",
    subjectKey: "orderDelivered",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, orderNumber, orderUrl },
    from: requireEmailConfig("ORDERS_EMAIL", ["EMAIL_FROM_SALES", "EMAIL_FROM"]),
    to: sanitizeEmail(customerEmail),
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendReviewRequestEmail({ customerEmail, customerName, orderNumber, reviewUrl }) {
  return sendMarketingEmail({
    templateName: "reviewRequest",
    subjectKey: "reviewRequest",
    subjectPayload: { orderNumber },
    templatePayload: { name: customerName, orderNumber, reviewUrl },
    email: customerEmail,
  });
}

export async function sendAbandonedCartReminder1Email({ email, name, cartUrl, products }) {
  return sendMarketingEmail({
    templateName: "abandonedCartReminder1",
    subjectKey: "abandonedCartReminder1",
    templatePayload: { name, cartUrl, products: normalizeProducts(products) },
    email,
  });
}

export async function sendAbandonedCartReminder2Email({ email, name, cartUrl, products }) {
  return sendMarketingEmail({
    templateName: "abandonedCartReminder2",
    subjectKey: "abandonedCartReminder2",
    templatePayload: { name, cartUrl, products: normalizeProducts(products) },
    email,
  });
}

export async function sendAbandonedCartReminder3Email({ email, name, cartUrl, products }) {
  return sendMarketingEmail({
    templateName: "abandonedCartReminder3",
    subjectKey: "abandonedCartReminder3",
    templatePayload: { name, cartUrl, products: normalizeProducts(products) },
    email,
  });
}

export async function sendLaunchAnnouncementEmail({ email, name, launchUrl, couponCode, discountPercent }) {
  return sendMarketingEmail({
    templateName: "launchAnnouncement",
    subjectKey: "launchAnnouncement",
    templatePayload: { name, launchUrl, couponCode, discountPercent },
    email,
  });
}

export async function sendNewDropAnnouncementEmail({ email, name, dropUrl, products }) {
  return sendMarketingEmail({
    templateName: "newDropAnnouncement",
    subjectKey: "newDropAnnouncement",
    templatePayload: { name, dropUrl, products: normalizeProducts(products) },
    email,
  });
}

export async function sendNewProductsAnnouncementEmail({ email, name, productsUrl, products }) {
  return sendMarketingEmail({
    templateName: "newProductsAnnouncement",
    subjectKey: "newProductsAnnouncement",
    templatePayload: { name, productsUrl, products: normalizeProducts(products) },
    email,
  });
}

export async function sendPromotionEmail({ email, name, promotionUrl, couponCode, couponDescription }) {
  return sendMarketingEmail({
    templateName: "promotionEmail",
    subjectKey: "promotionEmail",
    templatePayload: { name, promotionUrl, couponCode, couponDescription },
    email,
  });
}

export async function sendCrossSellEmail({ email, name, collectionUrl, products }) {
  return sendMarketingEmail({
    templateName: "crossSellEmail",
    subjectKey: "crossSellEmail",
    templatePayload: { name, collectionUrl, products: normalizeProducts(products) },
    email,
  });
}

export async function sendLoyaltyCouponEmail({ email, name, couponCode, couponDescription, shopUrl }) {
  return sendMarketingEmail({
    templateName: "loyaltyCouponEmail",
    subjectKey: "loyaltyCouponEmail",
    templatePayload: { name, couponCode, couponDescription, shopUrl },
    email,
  });
}

export async function sendInternalNewSaleAlertEmail({ customerName, customerEmail, orderNumber, total, items, orderUrl }) {
  const to = getAlertsRecipient();
  if (!to) {
    throw new Error("Missing env var: ALERTS_NOTIFICATION_EMAIL");
  }

  return sendEmail({
    templateName: "internalNewSaleAlert",
    subjectKey: "internalNewSaleAlert",
    subjectPayload: { orderNumber },
    templatePayload: {
      customerName,
      customerEmail,
      orderNumber,
      total,
      items: normalizeProducts(items),
      orderUrl,
    },
    from: requireEmailConfig("ORDERS_EMAIL", ["EMAIL_FROM_SALES", "EMAIL_FROM"]),
    to,
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendInternalLowStockAlertEmail({ products }) {
  const to = getAlertsRecipient();
  if (!to) {
    throw new Error("Missing env var: ALERTS_NOTIFICATION_EMAIL");
  }

  return sendEmail({
    templateName: "internalLowStockAlert",
    subjectKey: "internalLowStockAlert",
    subjectPayload: { totalProducts: Array.isArray(products) ? products.length : 0 },
    templatePayload: { products: normalizeProducts(products).map(item => ({ ...item, stock: Number(item.stock ?? 0) })) },
    from: requireEmailConfig("ORDERS_EMAIL", ["EMAIL_FROM_SALES", "EMAIL_FROM"]),
    to,
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendInternalPaymentFailedAlertEmail({
  customerName,
  customerEmail,
  orderNumber,
  total,
  failureReason,
}) {
  const to = getAlertsRecipient();
  if (!to) {
    throw new Error("Missing env var: ALERTS_NOTIFICATION_EMAIL");
  }

  return sendEmail({
    templateName: "internalPaymentFailedAlert",
    subjectKey: "internalPaymentFailedAlert",
    subjectPayload: { orderNumber },
    templatePayload: { customerName, customerEmail, orderNumber, total, failureReason },
    from: requireEmailConfig("EMAIL_FROM_FINANCE", ["EMAIL_FROM"]),
    to,
    replyTo: getDefaultReplyTo(),
  });
}

export async function sendWaitlistLaunchEmail({ email, couponCode, discountPercent, launchUrl }) {
  return sendLaunchAnnouncementEmail({
    email,
    couponCode,
    discountPercent,
    launchUrl,
    name: "cliente",
  });
}

export { assertStagingRecipientsAllowed, logEmailFailure, normalizeOrderItems, normalizeProducts, resolveAppUrl };
