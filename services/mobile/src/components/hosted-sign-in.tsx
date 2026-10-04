import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '@/providers/auth';
import { useAppTheme } from '@/theme';
import { PrimaryButton } from './ui';

WebBrowser.maybeCompleteAuthSession();

export function HostedSignIn({ onComplete }: { onComplete: () => void }) {
  const { colors } = useAppTheme();
  const { acceptIdentity } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const issuer = process.env.EXPO_PUBLIC_OIDC_ISSUER ?? '';
  const clientId = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? '';
  const discovery = AuthSession.useAutoDiscovery(issuer);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'keaenergy', path: 'auth' });
  const [request, , prompt] = AuthSession.useAuthRequest({ clientId, redirectUri,
    scopes: ['openid', 'profile', 'email'], responseType: AuthSession.ResponseType.Code, usePKCE: true }, discovery);
  async function signIn() {
    if (!discovery || !request || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await prompt();
      if (result.type !== 'success') return;
      if (!request.codeVerifier || result.params.state !== request.state) throw new Error('Sign-in could not be verified.');
      const tokens = await AuthSession.exchangeCodeAsync({ clientId, code: result.params.code, redirectUri,
        extraParams: { code_verifier: request.codeVerifier } }, discovery);
      if (!tokens.idToken) throw new Error('The sign-in provider returned no identity token.');
      await acceptIdentity(tokens.idToken, tokens.refreshToken ?? null);
      onComplete();
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'Sign-in could not complete.'); }
    finally { setBusy(false); }
  }
  return <><PrimaryButton label="Sign in securely with Kea" loading={busy} disabled={!request || !discovery || !clientId} onPress={() => { void signIn(); }} />{error ? <Text style={{ color: colors.icons.alert }}>{error}</Text> : null}</>;
}
