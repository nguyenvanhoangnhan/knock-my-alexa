import type { AlexaDirective, Env } from './types';
import { exchangeGrantCode } from './lwa';

/** Virtual doorbells exposed to Alexa. Add more entries to get more Routine triggers. */
export const DOORBELLS = [{ endpointId: 'doorbell-1', friendlyName: 'Knock Doorbell' }];

function header(namespace: string, name: string, extra: Record<string, unknown> = {}) {
  return { namespace, name, payloadVersion: '3', messageId: crypto.randomUUID(), ...extra };
}

export async function handleDirective(request: Request, env: Env): Promise<Response> {
  if (!env.DIRECTIVE_SECRET || request.headers.get('x-directive-secret') !== env.DIRECTIVE_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json<AlexaDirective>();
  const { namespace, name } = body.directive.header;

  if (namespace === 'Alexa.Discovery' && name === 'Discover') return discoverResponse();
  if (namespace === 'Alexa.Authorization' && name === 'AcceptGrant') return acceptGrant(env, body);
  if (namespace === 'Alexa' && name === 'ReportState') return stateReport(body);

  return Response.json({
    event: {
      header: header('Alexa', 'ErrorResponse', { correlationToken: body.directive.header.correlationToken }),
      endpoint: body.directive.endpoint,
      payload: { type: 'INVALID_DIRECTIVE', message: `Unhandled directive ${namespace}/${name}` },
    },
  });
}

function discoverResponse(): Response {
  return Response.json({
    event: {
      header: header('Alexa.Discovery', 'Discover.Response'),
      payload: {
        endpoints: DOORBELLS.map((d) => ({
          endpointId: d.endpointId,
          manufacturerName: 'knock-my-alexa',
          description: 'Virtual doorbell triggered over HTTP',
          friendlyName: d.friendlyName,
          displayCategories: ['DOORBELL'],
          capabilities: [
            { type: 'AlexaInterface', interface: 'Alexa', version: '3' },
            {
              type: 'AlexaInterface',
              interface: 'Alexa.DoorbellEventSource',
              version: '3',
              proactivelyReported: true,
            },
            {
              type: 'AlexaInterface',
              interface: 'Alexa.EndpointHealth',
              version: '3',
              properties: {
                supported: [{ name: 'connectivity' }],
                proactivelyReported: false,
                retrievable: true,
              },
            },
          ],
        })),
      },
    },
  });
}

async function acceptGrant(env: Env, body: AlexaDirective): Promise<Response> {
  const code = body.directive.payload.grant?.code;
  try {
    if (!code) throw new Error('AcceptGrant directive carried no grant code');
    await exchangeGrantCode(env, code);
    return Response.json({
      event: { header: header('Alexa.Authorization', 'AcceptGrant.Response'), payload: {} },
    });
  } catch (err) {
    return Response.json({
      event: {
        header: header('Alexa.Authorization', 'ErrorResponse'),
        payload: { type: 'ACCEPT_GRANT_FAILED', message: String(err) },
      },
    });
  }
}

function stateReport(body: AlexaDirective): Response {
  return Response.json({
    event: {
      header: header('Alexa', 'StateReport', { correlationToken: body.directive.header.correlationToken }),
      endpoint: { endpointId: body.directive.endpoint?.endpointId },
      payload: {},
    },
    context: {
      properties: [
        {
          namespace: 'Alexa.EndpointHealth',
          name: 'connectivity',
          value: { value: 'OK' },
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 0,
        },
      ],
    },
  });
}
