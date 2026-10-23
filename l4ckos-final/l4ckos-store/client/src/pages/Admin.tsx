import "../components/admin/AdminStage1.css";
import { AdminBatches } from "../components/admin/batches/AdminBatches";
﻿import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import { trpc } from "../lib/trpc";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import { useUser } from "../contexts/UserContext";
import { useToast } from "../contexts/ToastContext";
import { PRODUCT_CATEGORIES, getCategoryLabel, normalizeCategoryValue } from "../lib/productCategories";
import { formatPrice } from "../lib/utils";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  AdminEmptyState,
  AdminImagePreview,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
  AdminSurface,
  AdminSummaryPill,
  AdminTableWrapper,
} from "../components/admin/AdminUI";
import { AdminDashboard } from "../components/admin/dashboard/AdminDashboard";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import {
  ProductOptionPreview,
  ProductStockBadge,
  ProductVisualMeta,
  ProductsFilters,
  ProductsSummaryCards,
  type ProductListFilter,
} from "../components/admin/products/AdminProductsUI";
import {
  OrderDetailPanel,
  OrderOperationalAlerts,
  OrdersFilters,
  OrdersSummaryCards,
  OrderStatusBadge,
  type OrderListFilter,
} from "../components/admin/orders/AdminOrdersUI";
import { AdminCustomersPanel } from "../components/admin/customers/AdminCustomersPanel";
import { AdminCouponsPanel } from "../components/admin/coupons/AdminCouponsPanel";
import {
  AuditLogTable,
} from "../components/admin/system/AdminSystemUI";
import { AdminBackupPanel } from "../components/admin/system/AdminBackupPanel";
import { AdminSettingsUI } from "../components/admin/settings/AdminSettingsUI";
import { AdminReviewsPanel } from "../components/admin/reviews/AdminReviewsPanel";
import { AdminAuditPanel } from "../components/admin/system/AdminAuditPanel";
import { AdminProductsPanel } from "../components/admin/products/AdminProductsPanel";
import { AdminHomeHighlightsPanel } from "../components/admin/promotions/AdminHomeHighlightsPanel";
import { AdminReportsPanel } from "../components/admin/reports/AdminReportsPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

type Section =
  | "batches"
  | "overview"
  | "customers"
  | "products"
  | "promos"
  | "orders"
  | "reviews"
  | "coupons"
  | "reports"
  | "audit"
  | "backup"
  | "settings";

const orderStatuses = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
const productColorSuggestions = ["preto", "branco", "verde", "azul-marinho", "cinza", "caqui"] as const;
const alphaSizeSuggestions = ["PP", "P", "M", "G", "GG", "XG"] as const;
const numericSizeSuggestions = ["36", "38", "40", "42", "44", "46"] as const;
const emptyProductForm = {
  name: "",
  category: "",
  price: "",
  stock: "0",
  imageUrl: "",
  imageThumbnailUrl: "",
  imageDetailUrl: "",
  imageBannerUrl: "",
  imagesCsv: "",
  galleryColor: "",
  colorsCsv: "",
  sizesCsv: "",
  sizeType: "alpha",
  variantsCsv: "",
  description: "",
};

type UploadedImage = {
  url: string;
  originalUrl?: string | null;
  thumbnailUrl?: string | null;
  detailUrl?: string | null;
  bannerUrl?: string | null;
};

type ProductImageEntry = {
  imageUrl: string;
  imageThumbnailUrl?: string | null;
  imageDetailUrl?: string | null;
  imageBannerUrl?: string | null;
  color?: string | null;
};

function resolveAdminImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return "";
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://") || imageUrl.startsWith("data:")) {
    return imageUrl;
  }
  if (imageUrl.startsWith("/")) {
    return apiUrl(imageUrl);
  }
  return apiUrl(`/${imageUrl}`);
}


function normalizeAdminImageValue(imageUrl?: string | null) {
  const value = String(imageUrl ?? "").trim();
  if (!value) return "";
  return resolveAdminImageUrl(value);
}

function centsToMoneyInput(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2);
}

function parseMoneyToCents(raw: string) {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, "");
  if (!cleaned) return NaN;

  let normalized = cleaned;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

function joinCsvUrls(currentValue: string, urls: string[]) {
  const merged = [
    ...currentValue
      .split(",")
      .map(item => item.trim())
      .filter(Boolean),
    ...urls,
  ];

  return Array.from(new Set(merged)).join(", ");
}

function formatImageCsvEntry(entry: string | ProductImageEntry, color?: string | null) {
  const imageUrl = typeof entry === "string" ? entry : entry.imageUrl;
  const normalizedUrl = normalizeAdminImageValue(imageUrl);
  const normalizedColor = String(color ?? "").trim();
  const normalizedThumbnail = typeof entry === "string" ? "" : normalizeAdminImageValue(entry.imageThumbnailUrl);
  const normalizedDetail = typeof entry === "string" ? "" : normalizeAdminImageValue(entry.imageDetailUrl);
  const normalizedBanner = typeof entry === "string" ? "" : normalizeAdminImageValue(entry.imageBannerUrl);
  const parts = [normalizedUrl, normalizedColor, normalizedThumbnail, normalizedDetail, normalizedBanner];

  while (parts.length > 1 && !parts[parts.length - 1]) {
    parts.pop();
  }

  return parts.join("|");
}

function parseImageCsvEntries(raw: string): ProductImageEntry[] {
  return raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [imageUrlRaw, colorRaw, thumbnailRaw, detailRaw, bannerRaw] = item.split("|").map(part => part?.trim() ?? "");
      const imageUrl = normalizeAdminImageValue(imageUrlRaw);
      return {
        imageUrl,
        imageThumbnailUrl: normalizeAdminImageValue(thumbnailRaw) || null,
        imageDetailUrl: normalizeAdminImageValue(detailRaw) || null,
        imageBannerUrl: normalizeAdminImageValue(bannerRaw) || null,
        color: colorRaw || null,
      };
    })
    .filter(item => item.imageUrl);
}

function toProductImageEntry(upload: UploadedImage, color?: string | null): ProductImageEntry {
  return {
    imageUrl: normalizeAdminImageValue(upload.detailUrl || upload.url),
    imageThumbnailUrl: normalizeAdminImageValue(upload.thumbnailUrl) || null,
    imageDetailUrl: normalizeAdminImageValue(upload.detailUrl || upload.url) || null,
    imageBannerUrl: normalizeAdminImageValue(upload.bannerUrl) || null,
    color: color || null,
  };
}

function joinImageCsvEntries(currentValue: string, uploads: UploadedImage[], color?: string | null) {
  const current = parseImageCsvEntries(currentValue).map(item => formatImageCsvEntry(item, item.color));
  const incoming = uploads.map(upload => {
    const entry = toProductImageEntry(upload, color);
    return formatImageCsvEntry(entry, entry.color);
  });
  return Array.from(new Set([...current, ...incoming])).join(", ");
}

function removeImageCsvEntry(currentValue: string, targetUrl: string) {
  return parseImageCsvEntries(currentValue)
    .filter(item => item.imageUrl !== targetUrl)
    .map(item => formatImageCsvEntry(item, item.color))
    .join(", ");
}

function moveImageCsvEntryToCover(currentValue: string, targetUrl: string, currentCover: string) {
  const entries = parseImageCsvEntries(currentValue);
  const picked = entries.find(item => item.imageUrl === targetUrl);
  if (!picked) {
    return {
      imageUrl: currentCover,
      imagesCsv: currentValue,
    };
  }

  const nextEntries = entries.filter(item => item.imageUrl !== targetUrl);
  const normalizedCurrentCover = normalizeAdminImageValue(currentCover);
  if (normalizedCurrentCover && normalizedCurrentCover !== targetUrl) {
    nextEntries.unshift({ imageUrl: normalizedCurrentCover, color: null });
  }

  return {
    imageUrl: targetUrl,
    imageThumbnailUrl: picked.imageThumbnailUrl || "",
    imageDetailUrl: picked.imageDetailUrl || targetUrl,
    imageBannerUrl: picked.imageBannerUrl || "",
    imagesCsv: nextEntries.map(item => formatImageCsvEntry(item, item.color)).join(", "),
  };
}

function appendCsvToken(currentValue: string, token: string) {
  const items = currentValue
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  if (!items.includes(token)) items.push(token);
  return items.join(", ");
}

function parseProductOptionList(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(item => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildVariantDraft(name: string, colorsCsv: string, sizesCsv: string, price: string) {
  const colors = colorsCsv.split(",").map(item => item.trim()).filter(Boolean);
  const sizes = sizesCsv.split(",").map(item => item.trim()).filter(Boolean);
  const basePrice = price.trim();
  const combinations: string[] = [];

  if (colors.length > 0 && sizes.length > 0) {
    for (const color of colors) {
      for (const size of sizes) {
        combinations.push(`${name} ${color} ${size}|${color.toUpperCase()}-${size.toUpperCase()}|${basePrice}|0`);
      }
    }
    return combinations.join("; ");
  }

  if (sizes.length > 0) {
    return sizes.map(size => `${name} ${size}|${size.toUpperCase()}|${basePrice}|0`).join("; ");
  }

  if (colors.length > 0) {
    return colors.map(color => `${name} ${color}|${color.toUpperCase()}|${basePrice}|0`).join("; ");
  }

  return "";
}

function getOrderStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Pendente";
    case "paid":
      return "Aguardando preparação";
    case "processing":
      return "Em separação";
    case "shipped":
      return "Enviado";
    case "delivered":
      return "Entregue";
    case "cancelled":
      return "Cancelado";
    default:
      return status;
  }
}

function getOrderStatusTone(status: string): CSSProperties {
  switch (status) {
    case "paid":
      return { background: "rgba(21, 128, 61, 0.14)", border: "1px solid rgba(21, 128, 61, 0.28)", color: "#86efac" };
    case "processing":
      return { background: "rgba(15, 118, 110, 0.14)", border: "1px solid rgba(15, 118, 110, 0.28)", color: "#5eead4" };
    case "shipped":
      return { background: "rgba(37, 99, 235, 0.14)", border: "1px solid rgba(37, 99, 235, 0.28)", color: "#93c5fd" };
    case "delivered":
      return { background: "rgba(126, 34, 206, 0.14)", border: "1px solid rgba(126, 34, 206, 0.28)", color: "#d8b4fe" };
    case "cancelled":
      return { background: "rgba(185, 28, 28, 0.14)", border: "1px solid rgba(185, 28, 28, 0.28)", color: "#fca5a5" };
    default:
      return { background: "rgba(180, 83, 9, 0.14)", border: "1px solid rgba(180, 83, 9, 0.28)", color: "#fbbf24" };
  }
}

function formatAdminAddressLine(address?: {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
} | null) {
  if (!address) return [];

  const lineOne = [address.street, address.number].filter(Boolean).join(", ");
  const lineOneWithComplement = [lineOne, address.complement].filter(Boolean).join(" • ");
  const lineTwo = [address.neighborhood, [address.city, address.state].filter(Boolean).join(" - ")].filter(Boolean).join(" • ");
  const lineThree = address.zipCode ? `CEP ${address.zipCode}` : "";

  return [lineOneWithComplement, lineTwo, lineThree].filter(Boolean);
}

function confirmAdminAction(message: string) {
  return window.confirm(message);
}

export default function Admin() {
  const navigate = useNavigate();
  const isMobile = useIsMobile(1024);
  const isCompactAdmin = useIsMobile(1180);
  const { user, isAuthenticated, logout } = useUser();
  const { showToast } = useToast();
  const utils = trpc.useUtils();

  const [section, setSection] = useState<Section>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLElement | null>(null);
  const sectionNav = [
    { heading: "Visão geral", items: [{ key: "overview", label: "Dashboard / KPIs" }] },
    { heading: "Operação", items: [{ key: "orders", label: "Pedidos" }, { key: "products", label: "Produtos" }, { key: "customers", label: "Clientes" }, { key: "batches", label: "Lotes / Pré-venda" }] },
    { heading: "Comercial", items: [{ key: "promos", label: "Promoções" }, { key: "coupons", label: "Cupons" }, { key: "reviews", label: "Avaliações" }] },
    { heading: "Sistema", items: [{ key: "reports", label: "Relatórios" }, { key: "audit", label: "Auditoria" }, { key: "backup", label: "Backup" }, { key: "settings", label: "Configurações" }] },
  ] as const;

  useEffect(() => {
    if (!isMobile && mobileNavOpen) setMobileNavOpen(false);
  }, [isMobile, mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen || !isMobile) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuPanelRef.current?.querySelector<HTMLButtonElement>("button[aria-current='page'], button[aria-pressed='true']")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key === "Tab" && menuPanelRef.current) {
        const focusable = Array.from(menuPanelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = priorOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [mobileNavOpen, isMobile]);
  const [orderFilterStatus, setOrderFilterStatus] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [productFilter, setProductFilter] = useState<ProductListFilter>("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderQuickFilter, setOrderQuickFilter] = useState<OrderListFilter>("all");
  const [launchEmailForm, setLaunchEmailForm] = useState({
    couponCode: "lançamento15",
    discountPercent: "15",
    launchUrl: typeof window !== "undefined" ? window.location.origin : "",
    batchSize: "25",
  });
  const [launchEmailResult, setLaunchEmailResult] = useState<null | {
    total: number;
    sent: number;
    failed: number;
    message: string;
    failures: Array<{ email: string; message: string }>;
  }>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [newProduct, setNewProduct] = useState({ ...emptyProductForm });
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editProduct, setEditProduct] = useState({ ...emptyProductForm });
  const [quickProductEdits, setQuickProductEdits] = useState<Record<number, { price: string; stock: string }>>({});
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const createMainImageInputRef = useRef<HTMLInputElement | null>(null);
  const createGalleryImageInputRef = useRef<HTMLInputElement | null>(null);
  const editMainImageInputRef = useRef<HTMLInputElement | null>(null);
  const editGalleryImageInputRef = useRef<HTMLInputElement | null>(null);
  const isAdmin = user?.role === "admin";

  async function uploadAdminImages(files: FileList | null, mode: "single" | "multiple", target: string) {
    if (!files || files.length === 0) return [];

    const allowedFiles = Array.from(files).filter(file => file.type.startsWith("image/"));
    if (allowedFiles.length === 0) {
      showToast({ message: "Selecione ao menos uma imagem válida", duration: 2400 });
      return [];
    }

    setUploadingField(target);

    try {
      const uploadedImages: UploadedImage[] = [];

      for (const file of allowedFiles) {
        const formData = new FormData();
        formData.append("purpose", target.startsWith("promo-") ? "promotion" : "product");
        formData.append("file", file);

        const response = await csrfFetch(apiUrl("/api/upload"), {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.url) {
          throw new Error(payload?.error || "Falha ao enviar imagem");
        }

        uploadedImages.push({
          url: String(payload.url),
          originalUrl: payload.originalUrl ? String(payload.originalUrl) : null,
          thumbnailUrl: payload.thumbnailUrl ? String(payload.thumbnailUrl) : null,
          detailUrl: payload.detailUrl ? String(payload.detailUrl) : null,
          bannerUrl: payload.bannerUrl ? String(payload.bannerUrl) : null,
        });
        if (mode === "single") break;
      }

      showToast({
        message: uploadedImages.length > 1 ? "Imagens enviadas com sucesso" : "Imagem enviada com sucesso",
        duration: 2200,
      });

      return uploadedImages;
    } catch (error: any) {
      showToast({ message: error?.message || "Não foi possível enviar a imagem", duration: 2800 });
      return [];
    } finally {
      setUploadingField(null);
    }
  }

  const dashboardQuery = trpc.admin.dashboard.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const dashboardOrdersQuery = trpc.admin.ordersList.useQuery(undefined, { enabled: isAuthenticated && isAdmin && section === "overview" });
  const customersQuery = trpc.admin.usersList.useQuery(undefined, { enabled: isAuthenticated && isAdmin && section === "customers" });
  const reviewsQuery = trpc.admin.reviewsList.useQuery(undefined, { enabled: isAuthenticated && isAdmin && section === "reviews" });
  const productsQuery = trpc.admin.productsList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const ordersQuery = trpc.admin.ordersList.useQuery(
    orderFilterStatus ? { status: orderFilterStatus as any } : undefined,
    { enabled: isAuthenticated && isAdmin && section === "orders" },
  );
  const promoBannersQuery = trpc.admin.promoBannersList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const homeHighlightSettingsQuery = trpc.admin.homeHighlightSettingsGet.useQuery(undefined, { enabled: isAuthenticated && isAdmin && section === "promos" });
  const couponsQuery = trpc.admin.couponsList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const auditQuery = trpc.admin.auditList.useQuery({ limit: 200 }, { enabled: isAuthenticated && isAdmin });
  const backupsQuery = trpc.admin.backupsList.useQuery(undefined, { enabled: isAuthenticated && isAdmin && section === "backup" });
  const settingsStatusQuery = trpc.admin.settingsStatus.useQuery(undefined, { enabled: isAuthenticated && isAdmin });

  const setFlagsMutation = trpc.admin.userSetFlags.useMutation({
    onSuccess: () => {
      showToast({ message: "Cliente atualizado", duration: 2000 });
      void customersQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const reviewModerateMutation = trpc.admin.reviewModerate.useMutation({
    onSuccess: () => {
      showToast({ message: "Moderação atualizada", duration: 2200 });
      void reviewsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2800 }),
  });

  const createProductMutation = trpc.admin.productCreate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto criado", duration: 2000 });
      setNewProduct({ ...emptyProductForm });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updateProductMutation = trpc.admin.productUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto atualizado", duration: 2000 });
      setEditingProductId(null);
      setEditProduct({ ...emptyProductForm });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const quickUpdateProductMutation = trpc.admin.productUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto atualizado", duration: 2000 });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const deleteProductMutation = trpc.admin.productDelete.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto removido", duration: 2000 });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updateOrderMutation = trpc.admin.orderUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Pedido atualizado", duration: 2000 });
      void ordersQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const couponCreateMutation = trpc.admin.couponCreate.useMutation({
    onSuccess: () => {
      showToast({ message: "Cupom criado", duration: 2000 });
      void couponsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const couponUpdateMutation = trpc.admin.couponUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Cupom atualizado", duration: 2000 });
      void couponsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const couponDeleteMutation = trpc.admin.couponDelete.useMutation({
    onSuccess: () => {
      showToast({ message: "Cupom removido", duration: 2000 });
      void couponsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const confirmOrderPaymentMutation = trpc.admin.orderConfirmPayment.useMutation({
    onSuccess: data => {
      showToast({
        message: data.updated ? "Pagamento confirmado e auditado" : "O pagamento já estava confirmado",
        duration: 2400,
      });
      void ordersQuery.refetch();
      void dashboardQuery.refetch();
      void auditQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 3000 }),
  });

  const waitlistLaunchSendMutation = trpc.admin.waitlistLaunchSend.useMutation({
    onSuccess: data => {
      setLaunchEmailResult({
        total: data.total,
        sent: data.sent,
        failed: data.failed,
        message: data.message,
        failures: [...data.failures],
      });
      showToast({ message: data.message, duration: 3200 });
    },
    onError: error => showToast({ message: error.message, duration: 3200 }),
  });

  const createPromoBannerMutation = trpc.admin.promoBannerCreate.useMutation({
    onSuccess: () => {
      showToast({ message: "Destaque criado", duration: 2000 });
      void promoBannersQuery.refetch();
      void utils.products.homeHighlights.invalidate();
      void utils.products.promotions.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updatePromoBannerMutation = trpc.admin.promoBannerUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Destaque atualizado", duration: 2000 });
      void promoBannersQuery.refetch();
      void utils.products.homeHighlights.invalidate();
      void utils.products.promotions.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const reorderPromoBannerMutation = trpc.admin.promoBannerUpdate.useMutation({
    onSuccess: () => {
      void utils.products.homeHighlights.invalidate();
      void utils.products.promotions.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const deletePromoBannerMutation = trpc.admin.promoBannerDelete.useMutation({
    onSuccess: () => {
      showToast({ message: "Banner promocional removido", duration: 2000 });
      void promoBannersQuery.refetch();
      void utils.products.homeHighlights.invalidate();
      void utils.products.promotions.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updateHomeHighlightSettingsMutation = trpc.admin.homeHighlightSettingsUpdate.useMutation({
    onSuccess: async () => {
      showToast({ message: "Apresentação da Home atualizada", duration: 2200 });
      await Promise.all([
        homeHighlightSettingsQuery.refetch(),
        utils.products.homeHighlights.invalidate(),
      ]);
    },
    onError: error => showToast({ message: error.message, duration: 3000 }),
  });

  const backupManualMutation = trpc.admin.backupManual.useMutation({
    onSuccess: async data => {
      showToast({ message: `Arquivo JSON gravado localmente: ${data.fileName}. Durabilidade e integridade não verificadas.`, duration: 3800 });
      await backupsQuery.refetch();
    },
    onError: () => {
      showToast({ message: "Não foi possível confirmar a criação do arquivo. Atualize a lista para verificar o estado.", duration: 3800 });
      void backupsQuery.refetch();
    },
  });

  const searchedProducts = useMemo(() => {
    const normalizedSearch = productSearch.trim().toLowerCase();
    return [...(productsQuery.data ?? [])]
      .filter(row => {
        if (!normalizedSearch) return true;
        return [row.name, row.category, row.description, String(row.id)]
          .some(value => String(value ?? "").toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => b.id - a.id);
  }, [productSearch, productsQuery.data]);
  const productSummary = useMemo(() => {
    const rows = productsQuery.data ?? [];
    return {
      total: rows.length,
      withStock: rows.filter(row => row.salesMode !== "PREORDER" && Number(row.stock ?? 0) > 0).length,
      outOfStock: rows.filter(row => row.salesMode !== "PREORDER" && Number(row.stock ?? 0) <= 0).length,
      lowStock: rows.filter(row => row.salesMode !== "PREORDER" && Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5).length,
      withoutImage: rows.filter(row => !resolveAdminImageUrl(row.imageUrl)).length,
      withVariants: rows.filter(row => (row.variants?.length ?? 0) > 0).length,
    };
  }, [productsQuery.data]);
  const productFilterOptions = useMemo(
    () => [
      { key: "all" as const, label: "Todos", count: searchedProducts.length },
      { key: "lowStock" as const, label: "Estoque baixo", count: searchedProducts.filter(row => row.salesMode !== "PREORDER" && Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5).length },
      { key: "outOfStock" as const, label: "Sem estoque", count: searchedProducts.filter(row => row.salesMode !== "PREORDER" && Number(row.stock ?? 0) <= 0).length },
      { key: "withoutImage" as const, label: "Sem imagem", count: searchedProducts.filter(row => !resolveAdminImageUrl(row.imageUrl)).length },
      { key: "withVariants" as const, label: "Com variantes", count: searchedProducts.filter(row => (row.variants?.length ?? 0) > 0).length },
    ],
    [searchedProducts],
  );
  const products = useMemo(() => {
    return searchedProducts.filter(row => {
      if (productFilter === "lowStock") return row.salesMode !== "PREORDER" && Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5;
      if (productFilter === "outOfStock") return row.salesMode !== "PREORDER" && Number(row.stock ?? 0) <= 0;
      if (productFilter === "withoutImage") return !resolveAdminImageUrl(row.imageUrl);
      if (productFilter === "withVariants") return (row.variants?.length ?? 0) > 0;
      return true;
    });
  }, [productFilter, searchedProducts]);
  const searchedOrders = useMemo(() => {
    const normalizedSearch = orderSearch.trim().toLowerCase();
    return [...(ordersQuery.data ?? [])]
      .filter(row => {
        if (!normalizedSearch) return true;
        return [
          String(row.id),
          row.customerName,
          row.customerEmail,
          row.trackingCode,
          String(row.userId),
        ].some(value => String(value ?? "").toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => b.id - a.id);
  }, [orderSearch, ordersQuery.data]);
  const ordersSummary = useMemo(() => {
    const rows = ordersQuery.data ?? [];
    const withoutTracking = rows.filter(row => ["paid", "processing", "shipped"].includes(String(row.status ?? "")) && !row.trackingCode).length;
    return {
      total: rows.length,
      pending: rows.filter(row => row.status === "pending").length,
      paid: rows.filter(row => row.status === "paid").length,
      processing: rows.filter(row => row.status === "processing").length,
      shipped: rows.filter(row => row.status === "shipped").length,
      delivered: rows.filter(row => row.status === "delivered").length,
      cancelled: rows.filter(row => row.status === "cancelled").length,
      withoutTracking,
      revenueCents: rows.reduce((sum, row) => sum + Number(row.totalPrice ?? 0), 0),
    };
  }, [ordersQuery.data]);
  const orderFilterOptions = useMemo(
    () => [
      { key: "all" as const, label: "Todos", count: searchedOrders.length },
      { key: "pending" as const, label: "Pendentes", count: searchedOrders.filter(row => row.status === "pending").length },
      { key: "paid" as const, label: "Aguardando preparação", count: searchedOrders.filter(row => row.status === "paid").length },
      { key: "processing" as const, label: "Separação", count: searchedOrders.filter(row => row.status === "processing").length },
      { key: "shipped" as const, label: "Enviados", count: searchedOrders.filter(row => row.status === "shipped").length },
      { key: "delivered" as const, label: "Entregues", count: searchedOrders.filter(row => row.status === "delivered").length },
      { key: "cancelled" as const, label: "Cancelados", count: searchedOrders.filter(row => row.status === "cancelled").length },
      {
        key: "withoutTracking" as const,
        label: "Sem rastreio",
        count: searchedOrders.filter(row => ["paid", "processing", "shipped"].includes(String(row.status ?? "")) && !row.trackingCode).length,
      },
    ],
    [searchedOrders],
  );
  const orders = useMemo(() => {
    return searchedOrders.filter(row => {
      if (orderQuickFilter === "withoutTracking") return ["paid", "processing", "shipped"].includes(String(row.status ?? "")) && !row.trackingCode;
      if (orderQuickFilter === "all") return true;
      return row.status === orderQuickFilter;
    });
  }, [orderQuickFilter, searchedOrders]);
  // O Dashboard precisa refletir o conjunto completo retornado pela API,
  // independentemente da busca e dos filtros usados na aba Pedidos.
  const dashboardOrders = useMemo(() => dashboardOrdersQuery.data ?? [], [dashboardOrdersQuery.data]);
  const dashboardProducts = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const orderOperationalAlerts = useMemo(() => {
    const rows = ordersQuery.data ?? [];
    const paidWithoutTracking = rows.filter(row => row.status === "paid" && !row.trackingCode).length;
    const shippedWithoutTracking = rows.filter(row => row.status === "shipped" && !row.trackingCode).length;
    const oldPending = rows.filter(row => {
      if (row.status !== "pending" || !row.createdAt) return false;
      return Date.now() - new Date(row.createdAt).getTime() > 48 * 60 * 60 * 1000;
    }).length;
    const recentCancelled = rows.filter(row => {
      if (row.status !== "cancelled" || !row.createdAt) return false;
      return Date.now() - new Date(row.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
    }).length;

    return [
      ...(paidWithoutTracking > 0
        ? [{ title: `${paidWithoutTracking} pedido(s) aguardando preparação sem rastreio`, description: "Revise os pedidos que ainda não têm código de rastreio.", tone: "warning" as const }]
        : []),
      ...(shippedWithoutTracking > 0
        ? [{ title: `${shippedWithoutTracking} pedido(s) enviado(s) sem rastreio`, description: "Pedidos enviados deveriam ter rastreio conferido no painel.", tone: "danger" as const }]
        : []),
      ...(oldPending > 0
        ? [{ title: `${oldPending} pedido(s) pendente(s) há mais de 48h`, description: "Acompanhe para evitar pedidos esquecidos no fluxo.", tone: "warning" as const }]
        : []),
      ...(recentCancelled > 0
        ? [{ title: `${recentCancelled} cancelamento(s) recente(s)`, description: "Pedidos cancelados nos últimos 7 dias aparecem aqui para conferência.", tone: "neutral" as const }]
        : []),
    ];
  }, [ordersQuery.data]);
  const selectedOrder = useMemo(
    () => orders.find(order => order.id === selectedOrderId) ?? orders[0] ?? null,
    [orders, selectedOrderId],
  );
  const recentAudit = useMemo(() => (auditQuery.data ?? []).slice(0, 5), [auditQuery.data]);
  const orderStatusSummary = useMemo(
    () =>
      orderStatuses.map(status => ({
        status,
        label: getOrderStatusLabel(status),
        count: dashboardOrders.filter(order => order.status === status).length,
      })),
    [dashboardOrders],
  );
  const operationalAlerts = useMemo(() => {
    const alerts: Array<{ title: string; description: string; tone: "danger" | "warning" | "neutral" }> = [];
    const pendingOrders = dashboardOrders.filter(order => order.status === "pending").length;
    const paidOrders = dashboardOrders.filter(order => order.status === "paid").length;
    const emptyStockProducts = dashboardProducts.filter(product => product.salesMode !== "PREORDER" && Number(product.stock ?? 0) <= 0).length;
    const lowStockTotal = dashboardProducts.filter(product => product.salesMode !== "PREORDER" && Number(product.stock ?? 0) > 0 && Number(product.stock ?? 0) <= 5).length;

    if (pendingOrders > 0) {
      alerts.push({
        title: `${pendingOrders} pedido(s) aguardando pagamento`,
        description: "Acompanhe para evitar pedidos esquecidos no fluxo.",
        tone: "warning",
      });
    }
    if (paidOrders > 0) {
      alerts.push({
        title: `${paidOrders} pedido(s) pago(s) para separar`,
        description: "Priorize a operação de separação e envio.",
        tone: "neutral",
      });
    }
    if (emptyStockProducts > 0) {
      alerts.push({
        title: `${emptyStockProducts} produto(s) sem estoque`,
        description: "Revise disponibilidade antes de novas campanhas.",
        tone: "danger",
      });
    }
    if (lowStockTotal > 0) {
      alerts.push({
        title: `${lowStockTotal} produto(s) com estoque baixo`,
        description: "Itens com 1 a 5 unidades disponíveis.",
        tone: "warning",
      });
    }

    return alerts;
  }, [dashboardOrders, dashboardProducts]);
  const quickActions = useMemo(
    () => [
      { label: "Novo produto", caption: "Cadastre ou atualize o catálogo", onClick: () => setSection("products") },
      { label: "Pedidos", caption: "Acompanhe status e rastreio", onClick: () => setSection("orders") },
      { label: "Clientes", caption: "Revise VIP, bloqueios e perfis", onClick: () => setSection("customers") },
      { label: "Cupons", caption: "Gerencie promoções e descontos", onClick: () => setSection("coupons") },
    ],
    [],
  );
  const wideFieldStyle = { ...styles.mediaField, gridColumn: "1 / -1" } as CSSProperties;
  const mediumFieldStyle = {
    ...styles.mediaField,
    gridColumn: isCompactAdmin ? "1 / -1" : "span 2",
  } as CSSProperties;

  if (!isAuthenticated) {
    return (
      <div style={styles.centerCard}>
        <h1 style={styles.title}>Acesso negado</h1>
        <p style={styles.muted}>Faça login para acessar a área administrativa.</p>
        <button style={styles.primaryBtn} onClick={() => navigate("/login")}>Ir para login</button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={styles.centerCard}>
        <h1 style={styles.title}>Sem permissão</h1>
        <p style={styles.muted}>Esta área é exclusiva para administradores.</p>
        <button style={styles.primaryBtn} onClick={() => navigate("/")}>Voltar para início</button>
      </div>
    );
  }

  return (
    <div className="l4-admin">
      <style>{adminCss}</style>
      <button
        ref={menuButtonRef}
        className="l4-admin-menu-trigger"
        type="button"
        aria-expanded={mobileNavOpen}
        aria-controls="l4-admin-navigation"
        aria-haspopup="dialog"
        onClick={() => setMobileNavOpen(true)}
      >☰ <span>Menu administrativo</span></button>
      {mobileNavOpen && isMobile ? <button className="l4-admin-backdrop" type="button" aria-label="Fechar menu administrativo" onClick={() => { setMobileNavOpen(false); menuButtonRef.current?.focus(); }} /> : null}
      <div className="l4-admin-layout">
        <aside id="l4-admin-navigation" ref={menuPanelRef} className={`l4-admin-sidebar${mobileNavOpen ? " is-open" : ""}`} aria-label="Navegação administrativa" role={isMobile && mobileNavOpen ? "dialog" : undefined} aria-modal={isMobile && mobileNavOpen ? true : undefined} inert={isMobile && !mobileNavOpen}>
          <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span></div>
          <button className="l4-admin-menu-close" type="button" onClick={() => { setMobileNavOpen(false); menuButtonRef.current?.focus(); }}>Fechar menu</button>
          <nav className="l4-admin-nav-scroll" aria-label="Seções da gestão">
            <div role="group" aria-label="Áreas da gestão">
              {sectionNav.map(group => (
                <div className="l4-admin-nav-group" key={group.heading}>
                  <h2>{group.heading}</h2>
                  {group.items.map(item => (
                    <button key={item.key} type="button" aria-current={section === item.key ? "page" : undefined}
                      onClick={() => { setSection(item.key as Section); setMobileNavOpen(false); if (isMobile) menuButtonRef.current?.focus(); }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>
          <AdminSidebarProfile
            name={user?.name && user.name !== "Usuário" ? user.name : undefined}
            email={user?.email}
            onProfile={() => { setMobileNavOpen(false); navigate("/perfil"); }}
            onLogout={() => { setMobileNavOpen(false); logout(); }}
          />
        </aside>
        <main className="l4-admin-main">
          <AdminPageHeader
            className="l4-admin-page-header"
            title="Painel Administrativo"
            subtitle="Monitore o sistema, acompanhe pedidos, organize o catálogo e mantenha as operações críticas sob controle em um único lugar."
            actions={[
              { label: "Ver pedidos", onClick: () => setSection("orders") },
              { label: "Abrir produtos", onClick: () => setSection("products") },
            ]}
          />

      {section === "overview" && (
        <AdminDashboard
          dashboardData={dashboardQuery.data}
          dashboardLoading={dashboardQuery.isLoading}
          dashboardError={dashboardQuery.isError}
          onRetryDashboard={() => { void dashboardQuery.refetch(); }}
          isMobile={isMobile}
          isCompact={isCompactAdmin}
          orders={dashboardOrders}
          products={dashboardProducts}
          promoBanners={promoBannersQuery.data ?? []}
          coupons={couponsQuery.data ?? []}
          recentAudit={recentAudit}
          quickActions={quickActions}
          ordersLoading={dashboardOrdersQuery.isLoading}
          ordersError={dashboardOrdersQuery.isError}
          productsLoading={productsQuery.isLoading}
          productsError={productsQuery.isError}
          promoBannersLoading={promoBannersQuery.isLoading}
          promoBannersError={promoBannersQuery.isError}
          couponsLoading={couponsQuery.isLoading}
          couponsError={couponsQuery.isError}
          auditLoading={auditQuery.isLoading}
          auditError={auditQuery.isError}
          orderStatusSummary={orderStatusSummary}
          operationalAlerts={operationalAlerts}
          getOrderStatusLabel={getOrderStatusLabel}
          getOrderStatusTone={getOrderStatusTone}
          onViewOrder={orderId => {
            setSelectedOrderId(orderId);
            setSection("orders");
          }}
          onViewProduct={product => {
            setProductSearch(product.name ?? String(product.id));
            setSection("products");
          }}
        />
      )}

      {section === "reviews" && (
        <AdminReviewsPanel
          reviews={reviewsQuery.data}
          isLoading={reviewsQuery.isLoading}
          isError={reviewsQuery.isError}
          onRetry={() => { void reviewsQuery.refetch(); }}
          isPending={reviewModerateMutation.isPending}
          pendingReviewId={reviewModerateMutation.isPending ? reviewModerateMutation.variables?.reviewId : undefined}
          onModerate={async input => { await reviewModerateMutation.mutateAsync(input); }}
          onOpenOrder={orderId => {
            setOrderSearch(String(orderId));
            setOrderQuickFilter("all");
            setSelectedOrderId(orderId);
            setSection("orders");
          }}
          onOpenProduct={(productId, productName) => {
            setProductSearch(productName || String(productId));
            setProductFilter("all");
            setSection("products");
          }}
        />
      )}

      {section === "customers" && (
        <AdminCustomersPanel
          customers={customersQuery.data}
          isLoading={customersQuery.isLoading}
          isError={customersQuery.isError}
          onRetry={() => { void customersQuery.refetch(); }}
          pendingCustomerId={setFlagsMutation.isPending ? setFlagsMutation.variables?.userId : undefined}
          onToggleBlocked={async (userId, isBlocked) => {
            await setFlagsMutation.mutateAsync({ userId, isBlocked });
          }}
        />
      )}

      {section === "products" && (
        <AdminProductsPanel
          products={productsQuery.data}
          isLoading={productsQuery.isLoading}
          isError={productsQuery.isError}
          onRetry={() => { void productsQuery.refetch(); }}
          isSaving={createProductMutation.isPending || updateProductMutation.isPending || quickUpdateProductMutation.isPending || deleteProductMutation.isPending}
          onCreate={input => createProductMutation.mutateAsync(input)}
          onUpdate={input => updateProductMutation.mutateAsync(input)}
          onDelete={id => deleteProductMutation.mutateAsync({ id })}
          onUpload={uploadAdminImages}
          isUploading={uploadingField !== null}
          imageSource={resolveAdminImageUrl}
          initialSearch={productSearch}
        />
      )}

      {section === "batches" && <AdminBatches />}

      {section === "orders" && (
        <AdminSurface
          title="Pedidos"
          description="Gerencie o fluxo de pedidos com uma visão compacta e um painel lateral para detalhes operacionais."
          aside={
            <div style={styles.inlineRow}>
              <input
                style={{ ...styles.input, minWidth: 260 }}
                placeholder="Buscar pedido, cliente ou rastreio"
                value={orderSearch}
                onChange={e => setOrderSearch(e.target.value)}
              />
              <label>Status:</label>
              <Select value={orderFilterStatus || "all"} onValueChange={value => setOrderFilterStatus(value === "all" ? "" : value)}>
                <SelectTrigger className="admin-order-select-trigger" aria-label="Filtrar pedidos por situação"><SelectValue /></SelectTrigger>
                <SelectContent className="admin-order-select-content" position="popper" sideOffset={6} collisionPadding={12}>
                  <SelectItem value="all">Todas as situações</SelectItem>
                  {orderStatuses.map(status => <SelectItem key={status} value={status}>{getOrderStatusLabel(status)}</SelectItem>)}
                </SelectContent>
              </Select>
              <button style={styles.smallBtn} onClick={() => void ordersQuery.refetch()} disabled={ordersQuery.isFetching}>Atualizar</button>
            </div>
          }
        >
          <div className="admin-orders-real">
          <OrdersSummaryCards summary={ordersSummary} />
          <p className="admin-orders-accounting-note">O valor soma os pedidos atualmente carregados; o filtro por situação altera esse conjunto. Não representa valor recebido ou receita confirmada.</p>
          <div style={styles.inlineRow}>
            <AdminSummaryPill>Exibindo: {orders.length}</AdminSummaryPill>
            <AdminSummaryPill>Busca: {searchedOrders.length}</AdminSummaryPill>
          </div>
          <OrdersFilters value={orderQuickFilter} onChange={setOrderQuickFilter} options={orderFilterOptions} />
          <OrderOperationalAlerts alerts={orderOperationalAlerts} />
          {ordersQuery.isLoading ? (
            <AdminLoadingState>Carregando pedidos...</AdminLoadingState>
          ) : ordersQuery.isError ? (
            <div className="admin-orders-query-error" role="alert">
              <p>Não foi possível carregar os pedidos.</p>
              <button type="button" style={styles.smallBtn} onClick={() => void ordersQuery.refetch()} disabled={ordersQuery.isFetching}>Tentar novamente</button>
            </div>
          ) : orders.length === 0 ? (
            <AdminEmptyState
              title="Nenhum pedido encontrado"
              description="Ajuste o filtro ou aguarde novos pedidos aparecerem aqui."
            />
          ) : (
            <div
              style={{
                ...styles.orderAdminLayout,
                gridTemplateColumns: isCompactAdmin ? "1fr" : styles.orderAdminLayout.gridTemplateColumns,
              }}
            >
              <AdminTableWrapper>
                <table style={styles.table}>
                  <thead><tr><th>Pedido</th><th>Cliente</th><th>Total</th><th>Situação do pedido / pagamento</th><th>Rastreio</th><th>Itens</th><th>Ações</th></tr></thead>
                  <tbody>
                    {orders.map(row => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedOrderId(row.id)}
                        style={selectedOrder?.id === row.id ? styles.activeTableRow : undefined}
                      >
                        <td>
                          <div style={styles.orderPrimaryText}>#{row.id}</div>
                          <div style={styles.orderSecondaryText}>
                            {new Date(row.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}
                          </div>
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>{row.customerName || row.customerEmail || `Cliente #${row.userId}`}</div>
                          {row.customerEmail && row.customerName ? (
                            <div style={styles.orderSecondaryText}>{row.customerEmail}</div>
                          ) : null}
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>{formatPrice(Number(row.totalPrice) / 100)}</div>
                        </td>
                        <td>
                          <div className="admin-order-state-pair">
                          <OrderStatusBadge
                            status={String(row.status)}
                            label={getOrderStatusLabel(String(row.status))}
                            tone={getOrderStatusTone(String(row.status))}
                          />
                            <span className={`admin-payment-state ${row.paymentStatus === "confirmed" ? "is-confirmed" : "is-unconfirmed"}`}>
                              Pagamento: {row.paymentStatus === "confirmed" ? "Confirmado" : "Não confirmado"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>{row.trackingCode || "Pendente"}</div>
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>
                            {(row.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)} item(ns)
                          </div>
                          {(row.items ?? []).length > 0 ? (
                            <div style={styles.orderSecondaryText}>
                              {(row.items ?? [])
                                .slice(0, 1)
                                .map(item => item.productName || `Produto #${item.productId}`)
                                .join(", ")}
                            </div>
                          ) : null}
                        </td>
                        <td style={styles.actionsCell} onClick={event => event.stopPropagation()}>
                          <button type="button" style={styles.smallBtn} onClick={() => setSelectedOrderId(row.id)} aria-label={`Ver detalhes do pedido ${row.id}`}>
                            Ver detalhes
                          </button>
                          <Select
                            value={String(row.status)}
                            onValueChange={value => {
                              const nextStatus = value as typeof orderStatuses[number];
                              if (!confirmAdminAction(`Alterar o pedido #${row.id} para "${getOrderStatusLabel(String(nextStatus))}"?${nextStatus === 'cancelled' ? ' Cancelar o pedido não cancela a cobrança nem executa reembolso. Confira a situação financeira e as peças já produzidas.' : ''}`)) return;
                              updateOrderMutation.mutate({ orderId: row.id, status: nextStatus });
                            }}
                          >
                            <SelectTrigger className="admin-order-select-trigger" aria-label={`Atualizar situação do pedido ${row.id}`} disabled={updateOrderMutation.isPending}><SelectValue /></SelectTrigger>
                            <SelectContent className="admin-order-select-content" position="popper" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
                              {orderStatuses.map(status => <SelectItem key={status} value={status}>{getOrderStatusLabel(status)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <button
                            style={styles.smallBtn}
                            disabled={updateOrderMutation.isPending}
                            onClick={() => {
                              const tracking = window.prompt("Código de rastreio:", row.trackingCode || "");
                              if (tracking === null) return;
                              updateOrderMutation.mutate({ orderId: row.id, trackingCode: tracking || null });
                            }}
                          >
                            Rastreio
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableWrapper>

              <OrderDetailPanel
                order={selectedOrder}
                statusLabel={getOrderStatusLabel}
                statusTone={getOrderStatusTone}
                addressLines={formatAdminAddressLine}
                confirmingPayment={confirmOrderPaymentMutation.isPending}
                onConfirmPayment={order => {
                  if (!confirmAdminAction(
                    `Confirmar manualmente o pagamento do pedido #${order.id}? Esta ação registra seu usuário e horário na auditoria.`,
                  )) return;
                  confirmOrderPaymentMutation.mutate({ orderId: order.id });
                }}
              />
            </div>
          )}
          </div>
        </AdminSurface>
      )}

      {section === "promos" && (
        <AdminSurface
          title="Destaques da Home"
          description="Edite, ordene e ative as campanhas apresentadas na página inicial."
        >
          <AdminHomeHighlightsPanel
            records={promoBannersQuery.data ?? []}
            settings={homeHighlightSettingsQuery.data ?? null}
            settingsLoading={homeHighlightSettingsQuery.isLoading}
            settingsError={homeHighlightSettingsQuery.isError}
            settingsSaving={updateHomeHighlightSettingsMutation.isPending}
            isLoading={promoBannersQuery.isLoading}
            isError={promoBannersQuery.isError}
            isSaving={createPromoBannerMutation.isPending || updatePromoBannerMutation.isPending || reorderPromoBannerMutation.isPending}
            isDeleting={deletePromoBannerMutation.isPending}
            onRefresh={() => { void promoBannersQuery.refetch(); }}
            onUpdateSettings={input => updateHomeHighlightSettingsMutation.mutateAsync(input)}
            onCreate={input => createPromoBannerMutation.mutateAsync(input)}
            onUpdate={input => {
              if ("sortOrder" in input && Object.keys(input).length === 2) {
                return reorderPromoBannerMutation.mutateAsync(input);
              }
              return updatePromoBannerMutation.mutateAsync(input);
            }}
            onDelete={id => deletePromoBannerMutation.mutateAsync({ id })}
            onUpload={async (file, mobile) => {
              const transfer = new DataTransfer();
              transfer.items.add(file);
              const uploaded = await uploadAdminImages(transfer.files, "single", mobile ? "promo-image-mobile" : "promo-image");
              return uploaded[0]?.url ?? null;
            }}
          />
        </AdminSurface>
      )}

      {section === "coupons" && (
        <AdminSurface
          title="Cupons"
          description="Consulte, cadastre e atualize os cupons promocionais da loja."
        >
          <AdminCouponsPanel
            records={couponsQuery.data ?? []}
            isLoading={couponsQuery.isLoading}
            isError={couponsQuery.isError}
            isCreating={couponCreateMutation.isPending}
            isUpdating={couponUpdateMutation.isPending}
            isDeleting={couponDeleteMutation.isPending}
            onRefresh={() => { void couponsQuery.refetch(); }}
            onCreate={input => couponCreateMutation.mutateAsync(input)}
            onUpdate={input => couponUpdateMutation.mutateAsync(input)}
            onDelete={id => couponDeleteMutation.mutateAsync({ id })}
          />
          <div style={styles.launchCard}>
            <h3 style={styles.sectionTitle}>Avisar lista de espera sobre a abertura</h3>
            <p style={styles.muted}>
              Use esta ação para disparar o e-mail de lançamento para todos os cadastrados, com o cupom exclusivo de abertura.
            </p>
            <div style={styles.formGrid}>
              <input
                style={styles.input}
                placeholder="Código do cupom"
                value={launchEmailForm.couponCode}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, couponCode: e.target.value }))}
              />
              <input
                style={styles.input}
                placeholder="Percentual"
                value={launchEmailForm.discountPercent}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, discountPercent: e.target.value }))}
              />
              <input
                style={styles.input}
                placeholder="URL da loja"
                value={launchEmailForm.launchUrl}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, launchUrl: e.target.value }))}
              />
              <input
                style={styles.input}
                placeholder="Lote"
                value={launchEmailForm.batchSize}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, batchSize: e.target.value }))}
              />
            </div>
            <div style={styles.inlineRow}>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  const discountPercent = Number(launchEmailForm.discountPercent);
                  const batchSize = Number(launchEmailForm.batchSize);
                  if (!launchEmailForm.couponCode.trim()) {
                    showToast({ message: "Informe o código do cupom", duration: 2400 });
                    return;
                  }
                  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
                    showToast({ message: "Informe um percentual válido entre 1 e 100", duration: 2400 });
                    return;
                  }
                  if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 100) {
                    showToast({ message: "Informe um lote válido entre 1 e 100", duration: 2400 });
                    return;
                  }
                  if (!confirmAdminAction("Confirma o envio para toda a lista de espera?")) return;

                  setLaunchEmailResult(null);
                  waitlistLaunchSendMutation.mutate({
                    couponCode: launchEmailForm.couponCode.trim().toUpperCase(),
                    discountPercent,
                    launchUrl: launchEmailForm.launchUrl.trim(),
                    batchSize,
                  });
                }}
              >
                {waitlistLaunchSendMutation.isPending ? "Enviando..." : "Disparar e-mail de lançamento"}
              </button>
            </div>

            {launchEmailResult ? (
              <div style={styles.launchResult}>
                <strong>{launchEmailResult.message}</strong>
                <span>Total: {launchEmailResult.total}</span>
                <span>Enviados: {launchEmailResult.sent}</span>
                <span>Falhas: {launchEmailResult.failed}</span>

                {launchEmailResult.failures.length > 0 ? (
                  <AdminTableWrapper>
                    <table style={{ ...styles.table, minWidth: 640 }}>
                      <thead><tr><th>Email</th><th>Erro</th></tr></thead>
                      <tbody>
                        {launchEmailResult.failures.map(item => (
                          <tr key={`${item.email}-${item.message}`}>
                            <td>{item.email}</td>
                            <td>{item.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </AdminTableWrapper>
                ) : null}
              </div>
            ) : null}
          </div>
        </AdminSurface>
      )}

      {section === "reports" && (
        <AdminSurface title="Relatórios" description="Resumo operacional de pedidos criados no período selecionado.">
          <AdminReportsPanel enabled={isAuthenticated && isAdmin && section === "reports"} onMessage={message => showToast({ message, duration: 2800 })} />
        </AdminSurface>
      )}

      {section === "audit" && (
        <AdminSurface title="Auditoria" description="Consulte os eventos administrativos recentes registrados pelo sistema.">
          <AdminAuditPanel
            records={auditQuery.data ?? []}
            isLoading={auditQuery.isLoading}
            isError={auditQuery.isError}
            onRefresh={() => { void auditQuery.refetch(); }}
          />
        </AdminSurface>
      )}

      {section === "backup" && (
        <AdminSurface
          title="Backup"
          description="Consulte os arquivos listados pelo servidor e os limites conhecidos do armazenamento."
        >
          <AdminBackupPanel
            files={backupsQuery.data ?? []}
            isLoading={backupsQuery.isLoading}
            isError={backupsQuery.isError}
            isCreating={backupManualMutation.isPending}
            onRefresh={() => { void backupsQuery.refetch(); }}
            onCreateBackup={() => backupManualMutation.mutate()}
          />
        </AdminSurface>
      )}

      {section === "settings" && (
        <AdminSettingsUI
          onSelectSection={nextSection => setSection(nextSection)}
          runtimeStatus={settingsStatusQuery.data}
          runtimeStatusLoading={settingsStatusQuery.isLoading}
          runtimeStatusError={settingsStatusQuery.isError}
          onRetryRuntimeStatus={() => { void settingsStatusQuery.refetch(); }}
        />
      )}
        </main>
      </div>
    </div>
  );
}

const adminCss = `
.l4-admin table th,
.l4-admin table td {
  padding: 14px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  vertical-align: middle;
}
.l4-admin table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #101010;
  color: #b8bec8;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 800;
  text-align: left;
}
.l4-admin table td {
  background: rgba(255,255,255,0.01);
}
.l4-admin table tbody tr:hover td {
  background: rgba(239,68,68,0.045);
}
.l4-admin input:focus,
.l4-admin select:focus {
  outline: none;
  border-color: rgba(239,68,68,0.62) !important;
  box-shadow: 0 0 0 3px rgba(239,68,68,0.14);
}
.l4-admin button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.l4-admin button:hover:not(:disabled) {
  filter: brightness(1.08);
}
@media (max-width: 760px) {
  .l4-admin table th,
  .l4-admin table td {
    padding: 12px 10px;
  }
}
`;

const styles: Record<string, CSSProperties> = {
  centerCard: {
    maxWidth: 520,
    margin: "0 auto",
    padding: 20,
    border: "1px solid #2f2f2f",
    borderRadius: 12,
    background: "#111111",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    alignItems: "center",
    textAlign: "center",
  },
  title: {
    margin: 0,
    color: "#f0ede8",
    textAlign: "center",
  },
  muted: {
    margin: 0,
    color: "#a1a1aa",
    textAlign: "center",
  },
  tabs: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "flex-start",
    padding: 6,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.065)",
    background: "rgba(10,10,10,0.92)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
  },
  tabBtn: {
    border: "1px solid transparent",
    background: "transparent",
    color: "#9ca3af",
    borderRadius: 9,
    padding: "8px 11px",
    cursor: "pointer",
    fontWeight: 800,
    minHeight: 34,
    fontSize: 12,
    letterSpacing: "0.015em",
  },
  tabBtnActive: {
    background: "rgba(239,68,68,0.12)",
    color: "#f8f4ec",
    borderColor: "rgba(239,68,68,0.28)",
    boxShadow: "inset 0 -1px 0 rgba(239,68,68,0.28)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  kpiCard: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    padding: 16,
    background: "#111111",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    textAlign: "center",
  },
  card: {
    border: "1px solid rgba(255,255,255,0.075)",
    borderRadius: 18,
    background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.006)), #0d0d0d",
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    textAlign: "left",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  },
  launchCard: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    background: "#0d0d0d",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    textAlign: "center",
  },
  launchResult: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    background: "#111111",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "center",
    textAlign: "center",
  },
  sectionTitle: {
    margin: 0,
    color: "#f0ede8",
    textAlign: "left",
    fontSize: 24,
    lineHeight: 1.15,
  },
  productSectionHero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    flexWrap: "wrap",
    padding: "4px 0 2px",
  },
  productAdminHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    textAlign: "left",
    flexWrap: "wrap",
    minWidth: 0,
  },
  productAdminTitle: {
    margin: 0,
    color: "#f0ede8",
    fontSize: 20,
    fontWeight: 800,
    textAlign: "left",
  },
  productAdminText: {
    margin: "6px 0 0 0",
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.6,
    maxWidth: 720,
    textAlign: "left",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
    gap: 14,
    alignItems: "stretch",
    minWidth: 0,
  },
  couponCreateLayout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(260px, 0.65fr)",
    gap: 16,
    alignItems: "stretch",
  },
  couponCreateLayoutCompact: {
    gridTemplateColumns: "1fr",
  },
  couponField: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    textAlign: "left",
  },
  systemSplitGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: 16,
    alignItems: "stretch",
  },
  systemSplitGridCompact: {
    gridTemplateColumns: "1fr",
  },
  productAdminActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  productAdminEmpty: {
    border: "1px dashed #303030",
    borderRadius: 12,
    padding: 18,
    color: "#9ca3af",
    fontSize: 13,
    textAlign: "left",
    background: "#111111",
  },
  inlineRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
    minWidth: 0,
  },
  categoryPreviewBox: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "flex-start",
    textAlign: "left",
    gap: 6,
    padding: 14,
    border: "1px solid #2f2f2f",
    borderRadius: 12,
    background: "linear-gradient(135deg, #121212 0%, #181818 100%)",
    minHeight: 0,
    minWidth: 0,
    gridColumn: "1 / -1",
  },
  categoryPreviewLabel: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#9ca3af",
  },
  categoryPreviewValue: {
    color: "#f0ede8",
    fontSize: 18,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  categoryPreviewHint: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.6,
    maxWidth: 640,
  },
  mediaField: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #242424",
    background: "#101010",
    minWidth: 0,
  },
  mediaFieldTitle: {
    color: "#f0ede8",
    fontSize: 13,
    fontWeight: 800,
    textAlign: "left",
  },
  promoDestinationField: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
    textAlign: "left",
  },
  mediaActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  quickPickRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    minWidth: 0,
  },
  quickPickBtn: {
    border: "1px solid #2f2f2f",
    background: "#141414",
    color: "#f0ede8",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    maxWidth: "100%",
    overflowWrap: "anywhere",
  },
  mediaHint: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "left",
  },
  galleryPreviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(132px, 180px))",
    gap: 12,
    alignItems: "start",
  },
  galleryPreviewCard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    border: "1px solid #2f2f2f",
    background: "#111111",
    textAlign: "left",
    maxWidth: 180,
  },
  galleryPreviewImage: {
    width: "100%",
    aspectRatio: "4 / 5",
    objectFit: "contain",
    objectPosition: "center",
    display: "block",
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#080808",
  },
  galleryPreviewMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  galleryPreviewTitle: {
    color: "#f0ede8",
    fontSize: 13,
    fontWeight: 800,
  },
  galleryPreviewText: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.45,
  },
  galleryPreviewActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  hiddenFileInput: {
    display: "none",
  },
  promoPreviewCard: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 320px) minmax(280px, 1fr)",
    gap: 18,
    marginTop: 18,
    padding: 18,
    borderRadius: 14,
    border: "1px solid #2f2f2f",
    background: "linear-gradient(135deg, #101010 0%, #171717 100%)",
    alignItems: "stretch",
  },
  promoPreviewMediaGroup: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "1fr",
    alignItems: "start",
  },
  promoPreviewMedia: {
    minHeight: 220,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.06)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#121212",
  },
  promoPreviewMobileWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "flex-start",
  },
  promoPreviewDeviceLabel: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  promoPreviewMobile: {
    width: 140,
    height: 220,
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#121212",
  },
  promoPreviewImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  promoPreviewMobileImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  promoPreviewPlaceholder: {
    color: "#d1d5db",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 0.3,
  },
  promoPreviewContent: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    textAlign: "left",
    justifyContent: "center",
  },
  promoPreviewEyebrow: {
    color: "#9ca3af",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  promoPreviewBadge: {
    alignSelf: "flex-start",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    padding: "0 12px",
    borderRadius: 999,
    background: "#f0ede8",
    color: "#111111",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.3,
  },
  promoPreviewTitle: {
    color: "#f9fafb",
    fontSize: 28,
    lineHeight: 1.05,
    fontWeight: 900,
  },
  promoPreviewDescription: {
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 1.65,
    maxWidth: 560,
  },
  promoPreviewMetaRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },
  promoPreviewDiscount: {
    color: "#f9fafb",
    fontSize: 30,
    fontWeight: 900,
    lineHeight: 1,
  },
  promoPreviewDiscountLabel: {
    color: "#facc15",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  promoPreviewFooter: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 4,
  },
  promoPreviewCta: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    padding: "0 16px",
    borderRadius: 999,
    background: "#f0ede8",
    color: "#101010",
    fontSize: 13,
    fontWeight: 800,
  },
  promoPreviewLink: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
  },
  promoPreviewWarning: {
    color: "#fbbf24",
    fontSize: 12,
    lineHeight: 1.6,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(251, 191, 36, 0.28)",
    background: "rgba(120, 53, 15, 0.18)",
  },
  promoPreviewOrderHint: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.6,
    marginTop: 4,
  },
  input: {
    border: "1px solid #27272a",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 12,
    padding: "12px 14px",
    textAlign: "left",
    minHeight: 46,
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
  },
  select: {
    border: "1px solid #27272a",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 12,
    padding: "12px 14px",
    textAlign: "left",
    minHeight: 46,
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
  },
  table: {
    width: "100%",
    minWidth: 760,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 14,
    lineHeight: 1.4,
    color: "#e5e7eb",
    textAlign: "left",
  },
  activeTableRow: {
    outline: "1px solid rgba(239,68,68,0.30)",
    background: "rgba(239,68,68,0.055)",
  },
  orderAdminLayout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    gap: 16,
    alignItems: "start",
  },
  orderPrimaryText: {
    color: "#f0ede8",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.4,
  },
  orderSecondaryText: {
    marginTop: 2,
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.35,
  },
  productTableCell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "flex-start",
    textAlign: "left",
    minWidth: 0,
    maxWidth: 520,
  },
  productTableName: {
    color: "#f0ede8",
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  productTableMeta: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
    overflowWrap: "anywhere",
  },
  productMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 4,
  },
  categoryTableBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #2f2f2f",
    background: "#151515",
    color: "#f0ede8",
    fontSize: 12,
    fontWeight: 700,
  },
  stockInputLow: {
    border: "1px solid #7c5a10",
    background: "#17120a",
    color: "#facc15",
  },
  stockInputEmpty: {
    border: "1px solid #7f1d1d",
    background: "#160b0b",
    color: "#f87171",
  },
  productVisualCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    minWidth: 116,
  },
  productThumbStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 28px)",
    gap: 5,
    justifyContent: "center",
    maxWidth: 96,
  },
  productThumbLink: {
    width: 28,
    height: 34,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#080808",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  productThumbImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    objectPosition: "center",
    display: "block",
  },
  productThumbMore: {
    width: 28,
    height: 34,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#f0ede8",
    fontSize: 10,
    fontWeight: 800,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  productVisualMeta: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.3,
  },
  productVisualMetaStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  promoTablePreviewGroup: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    flexWrap: "wrap",
    minWidth: 280,
  },
  promoStatusStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    minWidth: 150,
  },
  promoMediaBadgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  dragHandle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: 700,
  },
  dragGrip: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 1,
    letterSpacing: -1,
    cursor: "grab",
  },
  variantCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 34,
    height: 30,
    padding: "0 10px",
    borderRadius: 999,
    border: "1px solid #2f2f2f",
    background: "#151515",
    color: "#f0ede8",
    fontSize: 12,
    fontWeight: 800,
  },
  quickEditGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(120px, 1fr))",
    gap: 10,
    minWidth: 260,
    maxWidth: 360,
  },
  quickEditField: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  quickEditLabel: {
    color: "#9ca3af",
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  actionsCell: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    minWidth: 112,
  },
  smallBtn: {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 9,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  primaryBtn: {
    border: "1px solid rgba(239,68,68,0.46)",
    background: "linear-gradient(135deg, #ef233c 0%, #991b1b 100%)",
    color: "#fff",
    borderRadius: 10,
    padding: "12px 16px",
    cursor: "pointer",
    minWidth: 180,
    fontWeight: 800,
    boxShadow: "0 12px 28px rgba(220,38,38,0.18)",
  },
  secondaryBtn: {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    minWidth: 128,
    fontWeight: 700,
  },
  dangerBtn: {
    border: "1px solid rgba(239,68,68,0.52)",
    background: "rgba(127,29,29,0.14)",
    color: "#f87171",
    borderRadius: 9,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
};

























