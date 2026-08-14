import type { Env } from './types';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const KV_KEY = 'lwa_tokens';

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

interface LwaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function requestTokens(env: Env, params: Record<string, string>): Promise<LwaTokenResponse> {
  if (!env.ALEXA_CLIENT_ID || !env.ALEXA_CLIENT_SECRET) {
    throw new Error('ALEXA_CLIENT_ID / ALEXA_CLIENT_SECRET not configured yet — set them with `wrangler secret put`');
  }
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: env.ALEXA_CLIENT_ID,
      client_secret: env.ALEXA_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`LWA token request failed: ${res.status} ${await res.text()}`);
  }
  return res.json<LwaTokenResponse>();
}

async function store(env: Env, t: LwaTokenResponse, fallbackRefreshToken?: string): Promise<StoredTokens> {
  const refreshToken = t.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) throw new Error('LWA response contained no refresh token');
  const stored: StoredTokens = {
    access_token: t.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + t.expires_in * 1000,
  };
  await env.TOKENS.put(KV_KEY, JSON.stringify(stored));
  return stored;
}

/** Called from AcceptGrant when the user enables the skill. */
export async function exchangeGrantCode(env: Env, code: string): Promise<void> {
  const t = await requestTokens(env, { grant_type: 'authorization_code', code });
  await store(env, t);
}

/** Returns a valid Event Gateway access token, refreshing it if it expires within a minute. */
export async function getAccessToken(env: Env): Promise<string> {
  const raw = await env.TOKENS.get(KV_KEY);
  if (!raw) {
    throw new Error('No LWA tokens stored yet — enable the skill in the Alexa app so AcceptGrant can run');
  }
  let tokens = JSON.parse(raw) as StoredTokens;
  if (Date.now() > tokens.expires_at - 60_000) {
    const t = await requestTokens(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    tokens = await store(env, t, tokens.refresh_token);
  }
  return tokens.access_token;
}
