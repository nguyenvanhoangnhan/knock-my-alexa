import type { Env } from './types';
import { DOORBELLS, handleDirective } from './directives';
import { getAccessToken } from './lwa';

const EVENT_GATEWAYS: Record<Env['ALEXA_REGION'], string> = {
  NA: 'https://api.amazonalexa.com/v3/events',
  EU: 'https://api.eu.amazonalexa.com/v3/events',
  FE: 'https://api.fe.amazonalexa.com/v3/events',
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/alexa/directive') return handleDirective(request, env);
    if (request.method === 'POST' && url.pathname === '/trigger') return handleTrigger(request, env);
    if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ok: true });
    return Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleTrigger(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (!env.TRIGGER_TOKEN || auth !== `Bearer ${env.TRIGGER_TOKEN}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const endpointId = new URL(request.url).searchParams.get('device') ?? DOORBELLS[0].endpointId;
  if (!DOORBELLS.some((d) => d.endpointId === endpointId)) {
    return Response.json({ error: `unknown device '${endpointId}'` }, { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(env);
  } catch (err) {
    // Not linked yet (or LWA rejected the refresh) — a config problem, not a gateway one.
    return Response.json({ ok: false, error: String(err) }, { status: 409 });
  }

  const event = {
    context: {},
    event: {
      header: {
        namespace: 'Alexa.DoorbellEventSource',
        name: 'DoorbellPress',
        payloadVersion: '3',
        messageId: crypto.randomUUID(),
      },
      endpoint: {
        scope: { type: 'BearerToken', token: accessToken },
        endpointId,
      },
      payload: {
        cause: { type: 'PHYSICAL_INTERACTION' },
        timestamp: new Date().toISOString(),
      },
    },
  };

  const res = await fetch(EVENT_GATEWAYS[env.ALEXA_REGION] ?? EVENT_GATEWAYS.NA, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });

  const gatewayBody = await res.text();
  return Response.json(
    { ok: res.ok, device: endpointId, gatewayStatus: res.status, gatewayBody: gatewayBody || null },
    { status: res.ok ? 200 : 502 },
  );
}
