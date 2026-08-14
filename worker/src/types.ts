import type { MessageQueue } from './custom';

export interface Env {
  TOKENS: KVNamespace;
  QUEUE: DurableObjectNamespace<MessageQueue>;
  /** Region of the Amazon account the skill belongs to, decides the Event Gateway host. */
  ALEXA_REGION: 'NA' | 'EU' | 'FE';
  /** From the skill's Permissions → Send Alexa Events page (wrangler secret). */
  ALEXA_CLIENT_ID?: string;
  ALEXA_CLIENT_SECRET?: string;
  /** Bearer token required on POST /trigger (wrangler secret). */
  TRIGGER_TOKEN?: string;
  /** Shared secret the Lambda shim sends on POST /alexa/directive (wrangler secret). */
  DIRECTIVE_SECRET?: string;
}

export interface AlexaDirective {
  directive: {
    header: {
      namespace: string;
      name: string;
      payloadVersion: string;
      messageId: string;
      correlationToken?: string;
    };
    endpoint?: { endpointId: string };
    payload: {
      grant?: { code: string };
      [key: string]: unknown;
    };
  };
}
