import {
  sendAbandonedCartReminder1Email,
  sendAbandonedCartReminder2Email,
  sendAbandonedCartReminder3Email,
  sendCrossSellEmail,
  sendInternalLowStockAlertEmail,
  sendInternalNewSaleAlertEmail,
  sendInternalPaymentFailedAlertEmail,
  sendLaunchAnnouncementEmail,
  sendLoyaltyCouponEmail,
  sendNewDropAnnouncementEmail,
  sendNewProductsAnnouncementEmail,
  logEmailFailure,
  sendPaymentNotFinishedEmail,
  sendPromotionEmail,
  resolveAppUrl,
  sendComingSoonConfirmationEmail,
  sendContactConfirmationEmail,
  sendNewContactInternalEmail,
  sendOrderCreatedEmail,
  sendOrderCancelledEmail,
  sendOrderDeliveredEmail,
  sendOrderPreparingEmail,
  sendPasswordResetEmail,
  sendPaymentApprovedEmail,
  sendPaymentFailedEmail,
  sendPaymentPendingEmail,
  sendReviewRequestEmail,
  sendShippingEmail,
  sendWaitlistLaunchEmail,
  sendWelcomeAccountEmail,
} from "./email/emailService.js";

export {
  sendComingSoonConfirmationEmail,
  sendAbandonedCartReminder1Email,
  sendAbandonedCartReminder2Email,
  sendAbandonedCartReminder3Email,
  sendNewContactInternalEmail,
  sendContactConfirmationEmail,
  sendWelcomeAccountEmail,
  sendPasswordResetEmail,
  sendOrderCreatedEmail,
  sendOrderCancelledEmail,
  sendPaymentPendingEmail,
  sendPaymentNotFinishedEmail,
  sendPaymentApprovedEmail,
  sendPaymentFailedEmail,
  sendInternalNewSaleAlertEmail,
  sendInternalLowStockAlertEmail,
  sendInternalPaymentFailedAlertEmail,
  sendOrderPreparingEmail,
  sendShippingEmail,
  sendOrderDeliveredEmail,
  sendReviewRequestEmail,
  sendLaunchAnnouncementEmail,
  sendNewDropAnnouncementEmail,
  sendNewProductsAnnouncementEmail,
  sendPromotionEmail,
  sendCrossSellEmail,
  sendLoyaltyCouponEmail,
  sendWaitlistLaunchEmail,
};

export async function sendContactNotificationToStore(payload) {
  return sendNewContactInternalEmail(payload);
}

export async function sendAutoReplyToCustomer(payload) {
  return sendContactConfirmationEmail(payload);
}

export async function sendWelcomeEmail(payload) {
  return sendWelcomeAccountEmail(payload);
}

export async function sendResetPasswordEmail(payload) {
  return sendPasswordResetEmail(payload);
}

export async function sendOrderReceivedEmail(payload) {
  return sendOrderCreatedEmail(payload);
}

export async function sendOrderShippedEmail({
  trackingCode,
  trackingUrl,
  ...payload
}) {
  return sendShippingEmail({ ...payload, trackingCode, trackingUrl });
}

export async function sendWaitlistEmail({ email }) {
  return sendNewContactInternalEmail({
    name: "Lista de espera",
    email,
    subject: "Nova inscricao na lista de espera",
    message: `Novo email cadastrado na lista de espera: ${email}`,
  });
}

export async function sendWaitlistAutoReply({ email }) {
  return sendComingSoonConfirmationEmail({
    email,
    launchUrl: resolveAppUrl(),
  });
}

export async function sendSupportEmail({ to, subject, html }) {
  console.warn(
    "[Email] sendSupportEmail is deprecated and should be replaced by a dedicated transactional email",
    {
      to,
      subject,
      hasHtml: Boolean(html),
    }
  );
  return { skipped: true };
}

export async function sendSalesEmail({ to, subject, html }) {
  console.warn(
    "[Email] sendSalesEmail is deprecated and should be replaced by a dedicated transactional email",
    {
      to,
      subject,
      hasHtml: Boolean(html),
    }
  );
  return { skipped: true };
}

export async function sendFinanceEmail({ to, subject, html }) {
  console.warn(
    "[Email] sendFinanceEmail is deprecated and should be replaced by a dedicated transactional email",
    {
      to,
      subject,
      hasHtml: Boolean(html),
    }
  );
  return { skipped: true };
}

export { logEmailFailure };
