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

export const siteMode: SiteMode = normalizeSiteMode(
  import.meta.env.VITE_SITE_MODE || (String(import.meta.env.VITE_COMING_SOON).toLowerCase() === "true" ? "coming-soon" : "store"),
);

export const contactChannels = {
  email: "contato@l4ckos.com.br",
  instagramUrl: "https://instagram.com/l4ckos",
  whatsappNumber: "",
  responseTime: "Buscamos responder em até 2 dias úteis.",
};

export function getWhatsAppUrl() {
  const digits = contactChannels.whatsappNumber.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}
