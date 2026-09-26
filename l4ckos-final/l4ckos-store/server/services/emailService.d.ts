type EmailProduct = {
  id?: number;
  productId?: number;
  name?: string;
  productName?: string;
  price?: string;
  formattedPrice?: string;
  imageUrl?: string;
  productImage?: string;
  stock?: number;
};

export function sendComingSoonConfirmationEmail(payload: {
  email: string;
  name?: string;
  launchUrl?: string;
}): Promise<unknown>;

export function sendContactConfirmationEmail(payload: {
  email: string;
  name?: string;
}): Promise<unknown>;

export function sendNewContactInternalEmail(payload: {
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
}): Promise<unknown>;

export function sendWelcomeAccountEmail(payload: {
  email: string;
  name?: string;
}): Promise<unknown>;

export function sendPasswordResetEmail(payload: {
  email: string;
  name?: string;
  resetUrl: string;
}): Promise<unknown>;

export function sendOrderCreatedEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  total: string;
  items?: Array<{ name: string; quantity: number; price?: string }>;
  orderUrl?: string;
}): Promise<unknown>;

export function sendPaymentPendingEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  total: string;
  paymentUrl?: string;
  dueLabel?: string;
}): Promise<unknown>;

export function sendPaymentNotFinishedEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  total: string;
  paymentUrl?: string;
  recoveryWindowLabel?: string;
}): Promise<unknown>;

export function sendPaymentApprovedEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  total: string;
}): Promise<unknown>;

export function sendPaymentFailedEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  total: string;
  paymentUrl?: string;
  failureReason?: string;
}): Promise<unknown>;

export function sendInternalNewSaleAlertEmail(payload: {
  customerName?: string;
  customerEmail?: string;
  orderNumber: string;
  total: string;
  items?: EmailProduct[];
  orderUrl?: string;
}): Promise<unknown>;

export function sendInternalLowStockAlertEmail(payload: {
  products: EmailProduct[];
}): Promise<unknown>;

export function sendInternalPaymentFailedAlertEmail(payload: {
  customerName?: string;
  customerEmail?: string;
  orderNumber: string;
  total: string;
  failureReason?: string;
}): Promise<unknown>;

export function sendOrderPreparingEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  total: string;
}): Promise<unknown>;

export function sendShippingEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  trackingCode?: string;
  trackingUrl?: string;
}): Promise<unknown>;

export function sendOrderDeliveredEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  orderUrl?: string;
}): Promise<unknown>;

export function sendReviewRequestEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  reviewUrl?: string;
  scheduledAt?: string;
}): Promise<unknown>;

export function sendAbandonedCartReminder1Email(payload: {
  email: string;
  name?: string;
  cartUrl?: string;
  products?: EmailProduct[];
}): Promise<unknown>;

export function sendAbandonedCartReminder2Email(payload: {
  email: string;
  name?: string;
  cartUrl?: string;
  products?: EmailProduct[];
}): Promise<unknown>;

export function sendAbandonedCartReminder3Email(payload: {
  email: string;
  name?: string;
  cartUrl?: string;
  products?: EmailProduct[];
}): Promise<unknown>;

export function sendLaunchAnnouncementEmail(payload: {
  email: string;
  name?: string;
  launchUrl?: string;
  couponCode?: string;
  discountPercent?: number;
}): Promise<unknown>;

export function sendNewDropAnnouncementEmail(payload: {
  email: string;
  name?: string;
  dropUrl?: string;
  products?: EmailProduct[];
}): Promise<unknown>;

export function sendNewProductsAnnouncementEmail(payload: {
  email: string;
  name?: string;
  productsUrl?: string;
  products?: EmailProduct[];
}): Promise<unknown>;

export function sendPromotionEmail(payload: {
  email: string;
  name?: string;
  promotionUrl?: string;
  couponCode?: string;
  couponDescription?: string;
}): Promise<unknown>;

export function sendCrossSellEmail(payload: {
  email: string;
  name?: string;
  collectionUrl?: string;
  products?: EmailProduct[];
}): Promise<unknown>;

export function sendLoyaltyCouponEmail(payload: {
  email: string;
  name?: string;
  couponCode: string;
  couponDescription?: string;
  shopUrl?: string;
}): Promise<unknown>;

export function sendWaitlistLaunchEmail(payload: {
  email: string;
  couponCode?: string;
  discountPercent?: number;
  launchUrl?: string;
}): Promise<unknown>;

export function sendContactNotificationToStore(payload: {
  name: string;
  email: string;
  subject?: string;
  message: string;
}): Promise<unknown>;

export function sendAutoReplyToCustomer(payload: {
  name?: string;
  email: string;
}): Promise<unknown>;

export function sendWelcomeEmail(payload: {
  name?: string;
  email: string;
}): Promise<unknown>;

export function sendOrderReceivedEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  total: string;
  items?: Array<{ name: string; quantity: number; price?: string }>;
  orderUrl?: string;
}): Promise<unknown>;

export function sendOrderShippedEmail(payload: {
  customerEmail: string;
  customerName?: string;
  orderNumber: string;
  trackingCode?: string;
  trackingUrl?: string;
}): Promise<unknown>;

export function sendWaitlistEmail(payload: {
  email: string;
}): Promise<unknown>;

export function sendWaitlistAutoReply(payload: {
  email: string;
}): Promise<unknown>;
