export type SiteMode = "store" | "coming-soon";

function normalizeSiteMode(value: unknown): SiteMode {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

  if (normalized === "coming-soon" || normalized === "comingsoon") {
    return "coming-soon";
  }

  return "store";
}

export function resolveSiteMode(env: {
  VITE_SITE_MODE?: unknown;
  VITE_COMING_SOON?: unknown;
  VITE_DEPLOY_TARGET?: unknown;
}): SiteMode {
  if (String(env.VITE_SITE_MODE ?? "").trim()) return normalizeSiteMode(env.VITE_SITE_MODE);
  if (String(env.VITE_COMING_SOON).toLowerCase() === "true") return "coming-soon";
  // A production frontend artifact fails closed if its explicit site mode was
  // omitted. Staging remains navigable, and this does not depend on backend NODE_ENV.
  if (String(env.VITE_DEPLOY_TARGET ?? "").trim().toLowerCase() === "production") return "coming-soon";
  return "store";
}

export const siteMode: SiteMode = resolveSiteMode({
  VITE_SITE_MODE: import.meta.env.VITE_SITE_MODE,
  VITE_COMING_SOON: import.meta.env.VITE_COMING_SOON,
  VITE_DEPLOY_TARGET: import.meta.env.VITE_DEPLOY_TARGET,
});

export const contactChannels = {
  email: "contato@l4ckos.com.br",
  instagramUrl: "https://www.instagram.com/l4ckosstore/",
  whatsappNumber: "",
  responseTime: "Buscamos responder em até 2 dias úteis.",
};

export function getWhatsAppUrl() {
  const digits = contactChannels.whatsappNumber.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}
