import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';

const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Single global queue instance. KV was tried first and failed: its cross-colo
 * propagation lag meant the skill (reading near us-east-1) missed messages queued
 * near the sender, and the read-modify-write in push resurrected drained ones.
 */
export class MessageQueue extends DurableObject {
  async push(speech: string): Promise<void> {
    // Millisecond timestamps keep list order chronological; the suffix avoids collisions.
    await this.ctx.storage.put(`m:${Date.now()}:${crypto.randomUUID()}`, speech);
  }

  /** Returns queued speeches once, oldest first, dropping anything stale. */
  async drain(): Promise<string[]> {
    const entries = await this.ctx.storage.list<string>({ prefix: 'm:' });
    if (entries.size === 0) return [];
    await this.ctx.storage.delete([...entries.keys()]);
    const now = Date.now();
    return [...entries]
      .filter(([key]) => now - Number(key.split(':')[1]) < MAX_AGE_MS)
      .map(([, speech]) => speech);
  }
}

function queue(env: Env) {
  return env.QUEUE.get(env.QUEUE.idFromName('queue'));
}

/** Called by /trigger so the custom skill can speak the message when the Routine opens it. */
export async function queueMessage(env: Env, speech: string): Promise<void> {
  await queue(env).push(speech);
}

export interface CustomSkillRequest {
  request?: { type?: string };
}

function inner(speech: string): string {
  return speech.replace(/^\s*<speak>/, '').replace(/<\/speak>\s*$/, '');
}

/** Sound effects only make sense once, even when several messages piled up. */
function stripAudio(ssml: string): string {
  return ssml.replace(/<audio[^>]*\/>/g, '');
}

/**
 * The Routine's "open skill" action lands here as a LaunchRequest: speak everything
 * queued since the last launch, then end the session.
 */
export async function handleCustomSkill(env: Env, body: CustomSkillRequest): Promise<Response> {
  if (body.request?.type === 'SessionEndedRequest') {
    return Response.json({ version: '1.0', response: {} });
  }

  const speeches = await queue(env).drain();

  const ssml =
    speeches.length === 0
      ? '<speak>There are no new messages.</speak>'
      : `<speak>${speeches
          .map((s, i) => (i === 0 ? inner(s) : stripAudio(inner(s))))
          .join('<break time="800ms"/>')}</speak>`;

  return Response.json({
    version: '1.0',
    response: { outputSpeech: { type: 'SSML', ssml }, shouldEndSession: true },
  });
}
