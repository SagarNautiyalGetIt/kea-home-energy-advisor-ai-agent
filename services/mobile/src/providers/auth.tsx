import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { registerAccount } from '@/lib/account-api';
import { apiJson, jsonRequest, loadAccessToken, storeTokenPair } from '@/lib/backend-client';

export type LocalSession = {
  customerId: string;
  displayName: string;
  email: string;
};

type AuthContextValue = {
  ready: boolean;
  session: LocalSession | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const STORAGE_KEY = 'kea-mobile-local-session-v2';
const AuthContext = createContext<AuthContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function authenticate(email: string, password: string) {
  const body: unknown = await apiJson('/api/auth/login', jsonRequest('POST', { email: email.trim().toLowerCase(), password }));
  if (!isRecord(body) || typeof body.customer_id !== 'string' || !body.customer_id.trim()) {
    throw new Error('Sign-in response did not include a customer ID.');
  }
  const token = typeof body.access_token === 'string' ? body.access_token : typeof body.token === 'string' ? body.token : null;
  if (!token) throw new Error('Sign-in response did not include a secure access token.');
  await storeTokenPair(token, typeof body.refresh_token === 'string' ? body.refresh_token : null);
  return {
    customerId: body.customer_id,
    displayName: typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name
      : displayNameFromEmail(email),
  };
}

function displayNameFromEmail(email: string) {
  const localPart = email.split('@')[0] ?? 'Kea customer';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Kea customer';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<LocalSession | null>(null);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(STORAGE_KEY), loadAccessToken()])
      .then(([saved]) => {
        if (saved) setSession(JSON.parse(saved) as LocalSession);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const persist = async (next: LocalSession) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  };

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    session,
    signIn: async (email, password) => {
      const authenticated = await authenticate(email, password);
      await persist({
        customerId: authenticated.customerId,
        displayName: authenticated.displayName,
        email: email.trim().toLowerCase(),
      });
    },
    signUp: async (name, email, password) => {
      const account = await registerAccount(name, email, password);
      if (!account.customer_id) throw new Error('Registration response did not include a customer ID.');
      const token = account.access_token ?? account.token;
      if (!token) throw new Error('Registration response did not include a secure access token.');
      await storeTokenPair(token, account.refresh_token ?? null);
      await persist({ customerId: account.customer_id, displayName: account.display_name || name.trim(), email: account.email ?? email.trim().toLowerCase() });
    },
    signOut: async () => {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await storeTokenPair(null, null);
      setSession(null);
    },
  }), [ready, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
