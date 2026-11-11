/**
 * UserContext - Gerencia informações de usuário logado
 * Fornece: user, login, logout, isAuthenticated
 */

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import type { User } from "../types/user";
import { trpc } from "../lib/trpc";

// ============= TIPOS =============

type UserContextType = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
};

// ============= CRIAR CONTEXTO =============

const UserContext = createContext<UserContextType | undefined>(undefined);

// ============= PROVIDER =============

/** tRPC keys look like [["auth","me"], {...}]. The session query itself must survive the purge. */
const isSessionQuery = (query: Query) => {
  const path = Array.isArray(query.queryKey[0]) ? (query.queryKey[0] as unknown[]).join(".") : "";
  return path === "auth.me";
};

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const identityRef = useRef<string | null | undefined>(undefined);
  /** Drops everything fetched for the previous identity (orders, attempts, profile...). */
  const purgeUserScopedCache = useCallback(() => {
    queryClient.removeQueries({ predicate: query => !isSessionQuery(query) });
  }, [queryClient]);
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
  });
  const logoutMutation = trpc.auth.logout.useMutation();

  const isAuthenticated = Boolean(meQuery.data);

  // Account switch (logout, or another tab signing in as someone else): never keep A's data for B.
  useEffect(() => {
    if (meQuery.isLoading) return;
    const identity = meQuery.data ? String((meQuery.data as { id?: number | string }).id ?? "") : null;
    const previous = identityRef.current;
    identityRef.current = identity;
    if (previous !== undefined && previous !== identity) purgeUserScopedCache();
  }, [meQuery.data, meQuery.isLoading, purgeUserScopedCache]);

  useEffect(() => {
    if (!meQuery.data) {
      if (!meQuery.isLoading) {
        setUserState(null);
      }
      return;
    }

    const serverUser = meQuery.data as {
      id?: number | string;
      name?: string | null;
      email?: string | null;
      role?: "user" | "admin";
      createdAt?: string | Date | null;
    };

    const mappedUser: User = {
      id: String(serverUser.id ?? ""),
      name: serverUser.name || "Usuário",
      email: serverUser.email || "",
      role: serverUser.role,
      isAuthenticated: true,
      createdAt: serverUser.createdAt ? new Date(serverUser.createdAt) : new Date(),
    };

    setUserState(mappedUser);
  }, [meQuery.data, meQuery.isLoading]);

  // 📌 Login (simulado - implementar com sua API)
  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(undefined);
    
    try {
      if (!email || !password) {
        throw new Error("Preencha email e senha.");
      }

      throw new Error("Login por email ainda não está integrado. Use 'Continuar com Google'.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao fazer login";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [utils.auth.me]);

  // 📌 Logout
  const logout = useCallback(() => {
    void (async () => {
      try {
        await logoutMutation.mutateAsync();
      } catch {
        // noop: mesmo com falha no backend, limpamos estado local
      } finally {
        setUserState(null);
        setError(undefined);
        purgeUserScopedCache();
        await utils.auth.me.invalidate();
      }
    })();
  }, [logoutMutation, utils.auth.me, purgeUserScopedCache]);

  // 📌 Definir usuário diretamente
  const setUser = useCallback((newUser: User | null) => {
    setUserState(newUser);
  }, []);

  const value: UserContextType = {
    user,
    isAuthenticated,
    isLoading: isLoading || meQuery.isLoading || logoutMutation.isPending,
    error,
    login,
    logout,
    setUser,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

// ============= HOOK =============

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser deve ser usado dentro de UserProvider");
  }
  return context;
}
