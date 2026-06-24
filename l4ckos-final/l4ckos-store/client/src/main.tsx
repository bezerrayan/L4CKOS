import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
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
    httpBatchLink({
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
  ],
});

// ============= RENDER =============

ReactDOM.createRoot(document.getElementById("root")!).render(
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
  </React.StrictMode>
);
