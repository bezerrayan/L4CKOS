import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "./lib/trpc";
import { apiUrl } from "./const";
import { csrfFetch, getCsrfToken } from "./lib/csrf";
// Providers
import { CartProvider } from "./contexts/CartContext";
import { FavoritesProvider } from "./contexts/FavoritesContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { UserProvider } from "./contexts/UserContext";
import { ToastProvider } from "./contexts/ToastContext";
import { DataSyncProvider } from "./components/DataSyncProvider";
import ErrorBoundary from "./components/ErrorBoundary";

import App from "./App";
import "./index.css";
import "./storefront.css";

// ============= SETUP TRPC =============

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: operation => import.meta.env.DEV &&
        operation.type === "query" &&
        ["products.list", "products.getById"].includes(operation.path),
      true: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch(url, options) {
          return fetch(url, { ...options, credentials: "omit" });
        },
      }),
      false: httpBatchLink({
        url: apiUrl("/api/trpc"),
        transformer: superjson,
        async fetch(url, options) {
          const method = options?.method || "GET";
          if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
            await getCsrfToken();
          }
          return csrfFetch(url, {
            ...options,
            credentials: "include",
          });
        },
      }),
    }),
  ],
});

// ============= RENDER =============

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (import.meta.env.DEV && window.location.pathname === "/__admin-orders-visual-preview") {
  void import("./pages/AdminOrdersVisualPreview").then(({ default: AdminOrdersVisualPreview }) => {
    root.render(<AdminOrdersVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-products-visual-preview") {
  void import("./pages/AdminProductsVisualPreview").then(({ default: AdminProductsVisualPreview }) => {
    root.render(<AdminProductsVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-customers-visual-preview") {
  void import("./pages/AdminCustomersVisualPreview").then(({ default: AdminCustomersVisualPreview }) => {
    root.render(<AdminCustomersVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-batches-visual-preview") {
  void import("./pages/AdminBatchesVisualPreview").then(({ default: AdminBatchesVisualPreview }) => {
    root.render(<AdminBatchesVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-promotions-visual-preview") {
  void import("./pages/AdminPromotionsVisualPreview").then(({ default: AdminPromotionsVisualPreview }) => {
    root.render(<AdminPromotionsVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-coupons-visual-preview") {
  void import("./pages/AdminCouponsVisualPreview").then(({ default: AdminCouponsVisualPreview }) => {
    root.render(<AdminCouponsVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-reviews-visual-preview") {
  void import("./pages/AdminReviewsVisualPreview").then(({ default: AdminReviewsVisualPreview }) => {
    root.render(<AdminReviewsVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-reports-visual-preview") {
  void import("./pages/AdminReportsVisualPreview").then(({ default: AdminReportsVisualPreview }) => {
    root.render(<AdminReportsVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-audit-visual-preview") {
  void import("./pages/AdminAuditVisualPreview").then(({ default: AdminAuditVisualPreview }) => {
    root.render(<AdminAuditVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-backup-visual-preview") {
  void import("./pages/AdminBackupVisualPreview").then(({ default: AdminBackupVisualPreview }) => {
    root.render(<AdminBackupVisualPreview />);
  });
} else if (import.meta.env.DEV && window.location.pathname === "/__admin-settings-visual-preview") {
  void import("./pages/AdminSettingsVisualPreview").then(({ default: AdminSettingsVisualPreview }) => {
    root.render(<AdminSettingsVisualPreview />);
  });
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="light" switchable={true}>
              <CartProvider>
                <FavoritesProvider>
                  <UserProvider>
                    <ToastProvider>
                      <DataSyncProvider>
                        <App />
                      </DataSyncProvider>
                    </ToastProvider>
                  </UserProvider>
                </FavoritesProvider>
              </CartProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </trpc.Provider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
