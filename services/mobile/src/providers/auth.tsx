import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  const normalizedEmail = email.trim().toLowerCase();
  // An unreachable API or rejected password must never turn into a local sign-in.
  const body: unknown = await apiJson('/api/auth/login', jsonRequest('POST', { email: normalizedEmail, password }));
  if (isRecord(body) && typeof body.customer_id === 'string' && body.customer_id.trim()) {
    const token = typeof body.access_token === 'string' ? body.access_token : typeof body.token === 'string' ? body.token : null;
    await storeTokenPair(token, typeof body.refresh_token === 'string' ? body.refresh_token : null);
    return {
      customerId: body.customer_id,
      displayName: typeof body.display_name === 'string' && body.display_name.trim()
        ? body.display_name
        : displayNameFromEmail(email),
    };
  }
  throw new Error('Sign-in response did not include a customer ID.');
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
      .then(([saved, token]) => {
        if (!saved) return;
        const parsed: unknown = JSON.parse(saved);
        if (!isRecord(parsed) || typeof parsed.customerId !== 'string' || typeof parsed.displayName !== 'string' || typeof parsed.email !== 'string') return;
        // A token-bearing session must not be restored after its secure token has gone.
        // Tokenless sessions are the documented demo-backend mode.
        if (token === null && parsed.email.endsWith('@kea.example') === false) return;
        setSession(parsed as LocalSession);
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
    signUp: async () => {
      throw new Error('Account registration is not available from the current Kea backend. Please use an approved demo account or contact Customer Care.');
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
