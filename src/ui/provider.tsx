// React context that provides auth state and helpers to the rest of the UI.
// Consumers wrap their app in <UsersAndTeamsProvider /> once at the root.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ProviderConfigContext } from './provider-internal.js';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  role: 'user' | 'owner';
  avatarColor: string;
  avatarInitials: string;
  avatarUrl: string | null;
}

export interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  /** Refetch /auth/me. */
  refresh: () => Promise<void>;
  /** Send a magic-link to the given email. */
  requestLink: (email: string) => Promise<{ ok: boolean; error?: string }>;
  /** Sign out current session. */
  logout: () => Promise<void>;
  /** Sign out every session for the current user. */
  logoutAll: () => Promise<void>;
  /** Update your own display name. */
  updateDisplayName: (displayName: string) => Promise<{ ok: boolean; error?: string }>;
  /** Delete your own account. */
  deleteAccount: () => Promise<{ ok: boolean; error?: string }>;
  /** Upload a photo for your own avatar. `dataUrl` is `data:image/...;base64,...`. */
  uploadAvatar: (dataUrl: string) => Promise<{ ok: boolean; error?: string }>;
  /** Remove your uploaded photo (revert to initials). */
  removeAvatar: () => Promise<{ ok: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface UsersAndTeamsProviderProps {
  children: ReactNode;
  /** Base URL for the auth API. Default: same-origin (empty string). */
  apiBase?: string;
  /** Override fetch (for tests or custom interceptors). */
  fetch?: typeof fetch;
}

export function UsersAndTeamsProvider({
  children,
  apiBase = '',
  fetch: fetchProp,
}: UsersAndTeamsProviderProps) {
  // Memoize the resolved fetch so its identity is stable across renders.
  // Otherwise hooks that depend on it (useAuth, useTeams) would refetch on
  // every parent render.
  const fetchFn = useMemo(
    () => fetchProp ?? globalThis.fetch.bind(globalThis),
    [fetchProp],
  );
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchFn(`${apiBase}/auth/me`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as { user: PublicUser };
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, fetchFn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestLink = useCallback(
    async (email: string) => {
      const res = await fetchFn(`${apiBase}/auth/request-link`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        return { ok: true };
      }
      if (res.status === 429) {
        return { ok: false, error: 'rate_limited' };
      }
      if (res.status === 400) {
        return { ok: false, error: 'invalid_email' };
      }
      return { ok: false, error: 'unknown' };
    },
    [apiBase, fetchFn],
  );

  const logout = useCallback(async () => {
    await fetchFn(`${apiBase}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    await refresh();
  }, [apiBase, fetchFn, refresh]);

  const logoutAll = useCallback(async () => {
    await fetchFn(`${apiBase}/auth/logout-all`, {
      method: 'POST',
      credentials: 'include',
    });
    await refresh();
  }, [apiBase, fetchFn, refresh]);

  const updateDisplayName = useCallback(
    async (displayName: string) => {
      const res = await fetchFn(`${apiBase}/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (res.ok) {
        await refresh();
        return { ok: true };
      }
      if (res.status === 400) return { ok: false, error: 'invalid_payload' };
      return { ok: false, error: 'unknown' };
    },
    [apiBase, fetchFn, refresh],
  );

  const deleteAccount = useCallback(async () => {
    const res = await fetchFn(`${apiBase}/me`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      await refresh();
      return { ok: true };
    }
    if (res.status === 403) return { ok: false, error: 'OWNER_SELF_DELETE' };
    return { ok: false, error: 'unknown' };
  }, [apiBase, fetchFn, refresh]);

  const uploadAvatar = useCallback(
    async (dataUrl: string) => {
      const res = await fetchFn(`${apiBase}/me/avatar`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataUrl }),
      });
      if (res.ok) {
        await refresh();
        return { ok: true };
      }
      if (res.status === 501) return { ok: false, error: 'avatar_store_not_configured' };
      if (res.status === 400) return { ok: false, error: 'invalid_image' };
      return { ok: false, error: 'unknown' };
    },
    [apiBase, fetchFn, refresh],
  );

  const removeAvatar = useCallback(async () => {
    const res = await fetchFn(`${apiBase}/me/avatar`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      await refresh();
      return { ok: true };
    }
    return { ok: false, error: 'unknown' };
  }, [apiBase, fetchFn, refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refresh,
      requestLink,
      logout,
      logoutAll,
      updateDisplayName,
      deleteAccount,
      uploadAvatar,
      removeAvatar,
    }),
    [
      user,
      loading,
      refresh,
      requestLink,
      logout,
      logoutAll,
      updateDisplayName,
      deleteAccount,
      uploadAvatar,
      removeAvatar,
    ],
  );

  const config = useMemo(() => ({ apiBase, fetch: fetchFn }), [apiBase, fetchFn]);

  return (
    <ProviderConfigContext.Provider value={config}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </ProviderConfigContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      'useAuth must be used inside <UsersAndTeamsProvider>. Wrap your app at the root.',
    );
  }
  return ctx;
}
