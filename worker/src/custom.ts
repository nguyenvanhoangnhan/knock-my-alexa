import type { Env } from './types';

const QUEUE_KEY = 'msg_queue';
const QUEUE_TTL_S = 600;

interface QueuedMessage {
  /** Full SSML: `<speak>…</speak>` */
  speech: string;
  at: number;
}

/** Called by /trigger so the custom skill can speak the message when the Routine opens it. */
export async function queueMessage(env: Env, speech: string): Promise<void> {
  const raw = await env.TOKENS.get(QUEUE_KEY);
  const queue = raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
  queue.push({ speech, at: Date.now() });
  await env.TOKENS.put(QUEUE_KEY, JSON.stringify(queue.slice(-5)), {
    expirationTtl: QUEUE_TTL_S,
  });
}

export interface CustomSkillRequest {
  request?: { type?: string };
}

/**
 * The Routine's "open skill" action lands here as a LaunchRequest: speak everything
 * queued since the last launch, then end the session.
 */
export async function handleCustomSkill(env: Env, body: CustomSkillRequest): Promise<Response> {
  if (body.request?.type === 'SessionEndedRequest') {
    return Response.json({ version: '1.0', response: {} });
  }

  const raw = await env.TOKENS.get(QUEUE_KEY);
  const queue: QueuedMessage[] = raw ? JSON.parse(raw) : [];
  const fresh = queue.filter((m) => Date.now() - m.at < QUEUE_TTL_S * 1000);
  if (raw) await env.TOKENS.delete(QUEUE_KEY);

  const ssml =
    fresh.length === 0
      ? '<speak>There are no new messages.</speak>'
      : `<speak>${fresh.map(inner).join('<break time="800ms"/>')}</speak>`;

  return Response.json({
    version: '1.0',
    response: { outputSpeech: { type: 'SSML', ssml }, shouldEndSession: true },
  });
}

function inner(m: QueuedMessage): string {
  return m.speech.replace(/^\s*<speak>/, '').replace(/<\/speak>\s*$/, '');
}
