import { ComingSoonConfirmation } from "../../emails/transactional/ComingSoonConfirmation.jsx";
import { ContactConfirmation } from "../../emails/transactional/ContactConfirmation.jsx";
import { NewContactInternal } from "../../emails/transactional/NewContactInternal.jsx";
import { OrderCreated } from "../../emails/transactional/OrderCreated.jsx";
import { PaymentPending } from "../../emails/transactional/PaymentPending.jsx";
import { PaymentApproved } from "../../emails/transactional/PaymentApproved.jsx";
import { PaymentFailed } from "../../emails/transactional/PaymentFailed.jsx";
import { OrderPreparing } from "../../emails/transactional/OrderPreparing.jsx";
import { OrderShipped } from "../../emails/transactional/OrderShipped.jsx";
import { OrderDelivered } from "../../emails/transactional/OrderDelivered.jsx";
import { PasswordReset } from "../../emails/transactional/PasswordReset.jsx";
import { WelcomeAccount } from "../../emails/transactional/WelcomeAccount.jsx";
import { ExclusiveAccessNotification } from "../../emails/transactional/ExclusiveAccessNotification.jsx";
import { PaymentNotFinished } from "../../emails/transactional/PaymentNotFinished.jsx";
import { InternalNewSaleAlert } from "../../emails/transactional/InternalNewSaleAlert.jsx";
import { InternalLowStockAlert } from "../../emails/transactional/InternalLowStockAlert.jsx";
import { InternalPaymentFailedAlert } from "../../emails/transactional/InternalPaymentFailedAlert.jsx";
import { LaunchAnnouncement } from "../../emails/marketing/LaunchAnnouncement.jsx";
import { NewDropAnnouncement } from "../../emails/marketing/NewDropAnnouncement.jsx";
import { NewProductsAnnouncement } from "../../emails/marketing/NewProductsAnnouncement.jsx";
import { PromotionEmail } from "../../emails/marketing/PromotionEmail.jsx";
import { AbandonedCartReminder1 } from "../../emails/marketing/AbandonedCartReminder1.jsx";
import { AbandonedCartReminder2 } from "../../emails/marketing/AbandonedCartReminder2.jsx";
import { AbandonedCartReminder3 } from "../../emails/marketing/AbandonedCartReminder3.jsx";
import { ReviewRequest } from "../../emails/marketing/ReviewRequest.jsx";
import { CrossSellEmail } from "../../emails/marketing/CrossSellEmail.jsx";
import { LoyaltyCouponEmail } from "../../emails/marketing/LoyaltyCouponEmail.jsx";

const templateMap = {
  comingSoonConfirmation: ComingSoonConfirmation,
  contactConfirmation: ContactConfirmation,
  newContactInternal: NewContactInternal,
  welcomeAccount: WelcomeAccount,
  exclusiveAccessNotification: ExclusiveAccessNotification,
  passwordReset: PasswordReset,
  paymentNotFinished: PaymentNotFinished,
  orderCreated: OrderCreated,
  paymentPending: PaymentPending,
  paymentApproved: PaymentApproved,
  paymentFailed: PaymentFailed,
  internalNewSaleAlert: InternalNewSaleAlert,
  internalLowStockAlert: InternalLowStockAlert,
  internalPaymentFailedAlert: InternalPaymentFailedAlert,
  orderPreparing: OrderPreparing,
  orderShipped: OrderShipped,
  orderDelivered: OrderDelivered,
  reviewRequest: ReviewRequest,
  launchAnnouncement: LaunchAnnouncement,
  newDropAnnouncement: NewDropAnnouncement,
  newProductsAnnouncement: NewProductsAnnouncement,
  promotionEmail: PromotionEmail,
  abandonedCartReminder1: AbandonedCartReminder1,
  abandonedCartReminder2: AbandonedCartReminder2,
  abandonedCartReminder3: AbandonedCartReminder3,
  crossSellEmail: CrossSellEmail,
  loyaltyCouponEmail: LoyaltyCouponEmail,
};

export function renderEmailTemplate(templateName, payload) {
  const Template = templateMap[templateName];
  if (!Template) {
    throw new Error(`Unknown email template: ${templateName}`);
  }

  return Template(payload ?? {});
}
