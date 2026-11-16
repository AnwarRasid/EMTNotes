// The smart tester's Claude transport (Plan 3 Task 9): one Messages API call per check, from the browser, with the
// trainee's own key. The only file that touches '@anthropic-ai/sdk', and only by dynamic import (D18), so the SDK loads
// in its own chunk the first time a check or Test key needs it and never weighs on the app's start.
// - What is sent (D13, D17): the request Task 8's core built (its sentences already masked), as the user message, with
//   SMART_SYSTEM, low effort and no thinking field (Opus 5.5 thinks adaptively), and a json_schema answer whose point
//   keys can only be the request's candidates. Every model goes through client.messages.create, with no betas and no
//   fallbacks (D19): a refusal reads as no verdict, so the line keeps its keyword reading.
// - Where (D18): only https://api.anthropic.com, with the key only in the SDK's auth header (`Authorization: Bearer`:
//   SDK 1.x sends every API key that way, never as x-api-key) beside the SDK's own
//   anthropic-dangerous-direct-browser-access header; a 6 s timeout and no retries (D14). Nothing here logs the key, the
//   headers or the body, and the SDK's own logging is off.
import type Anthropic from '@anthropic-ai/sdk';
import * as v from 'valibot';
import { keywordGrader, type Grader } from '../sim/grader';
import {
  SMART_TIMEOUT_MS, smartGrader, type SmartRequest, type SmartTransport, type SmartUsage, type SmartVerdict,
} from '../sim/smart';
import { SMART_MODELS, smartReady, type SmartModelId, type SmartSettings } from './settings';

/** The one host the smart tester talks to, set here so nothing in the environment can point the SDK elsewhere. */
const ANTHROPIC_API = 'https://api.anthropic.com';
/** The start of the 401 message an organisation that refuses browser calls answers with (ZDR or Compliance API). */
const CORS_REFUSED = 'CORS requests are not allowed for this Organization';

export const SMART_SYSTEM = [
  "You check sentences from an EMT trainee's PAM practice run, for a practice simulator.",
  'The user message is JSON: the step the run is at, whether the crew has arrived on scene, the sentences to check (each ' +
    'with its index in the line), the candidate points (each with its key, label and parts), and facts about the made-up ' +
    'case. In the sentences, "the patient", "the IC" and "the address" stand in for what the trainee said.',
  "For each listed sentence, return the candidate points it clearly says or asks, in the trainee's own words. For a " +
    'point with parts, name only the parts the sentence says.',
  'Name a part only when the sentence says it. Return no points for a sentence that says none. Never guess.',
  'Never credit a point because it would be the right next step.',
  'Return only the JSON the schema allows.',
].join('\n');

/** The answer's JSON schema (structured outputs): for each sentence sent (by its index), the points it says, each by a
 *  candidate's key with its parts. Every object closed (additionalProperties false), as structured outputs require. */
export function verdictSchema(req: SmartRequest): Record<string, unknown> {
  const parts = [...new Set(req.candidates.flatMap((c) => c.parts.map((p) => p.id)))];
  return {
    type: 'object',
    properties: {
      sentences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', enum: req.sentences.map((s) => s.index) },
            points: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', enum: req.candidates.map((c) => c.key) },
                  parts: { type: 'array', items: parts.length > 0 ? { type: 'string', enum: parts } : { type: 'string' } },
                },
                required: ['key', 'parts'],
                additionalProperties: false,
              },
            },
          },
          required: ['index', 'points'],
          additionalProperties: false,
        },
      },
    },
    required: ['sentences'],
    additionalProperties: false,
  };
}

/** The Messages request for one check (D13, D17, D19): the same fields for every model, no thinking, betas or
 *  fallbacks. The request itself is the user message, so only what Task 8's core put in it (D17) is ever sent. */
export function requestBody(req: SmartRequest, model: SmartModelId): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 2048,
    system: SMART_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(req) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: verdictSchema(req) } },
  };
}

const VerdictSchema = v.object({
  sentences: v.array(v.object({
    index: v.pipe(v.number(), v.integer()),
    points: v.array(v.object({ key: v.string(), parts: v.array(v.string()) })),
  })),
});

/** The verdict in an answer's text block, or null: on a refusal (D19), with no text block, or when the text is not
 *  JSON or not a verdict's shape. */
export function parseVerdict(message: { stop_reason: string | null; content: readonly { type: string; text?: string }[] }):
  SmartVerdict | null {
  if (message.stop_reason === 'refusal') return null;
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (text === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = v.safeParse(VerdictSchema, parsed);
  return result.success ? result.output : null;
}

/** The SDK, loaded once, the first time it is needed. A failed load (offline before it was ever cached) is tried
 *  again next time. */
let sdk: Promise<typeof import('@anthropic-ai/sdk')> | null = null;
function loadSdk(): Promise<typeof import('@anthropic-ai/sdk')> {
  sdk ??= import('@anthropic-ai/sdk').catch((e: unknown) => {
    sdk = null;
    throw e;
  });
  return sdk;
}

/** A client for `apiKey` (D18): browser calls allowed, which sends the SDK's direct-browser-access header; the one
 *  6 s budget and no retries (D14); only api.anthropic.com; no SDK logging. */
async function clientFor(apiKey: string, fetch: typeof globalThis.fetch | undefined): Promise<Anthropic> {
  const { default: SDK } = await loadSdk();
  return new SDK({
    apiKey, dangerouslyAllowBrowser: true, timeout: SMART_TIMEOUT_MS, maxRetries: 0, baseURL: ANTHROPIC_API, logLevel: 'off',
    ...(fetch === undefined ? {} : { fetch }),
  });
}

/** How a check's spend is told: its usage, and the model that answered it, to price it at (Task 9 review M6). */
export type OnSpend = (u: SmartUsage, model: SmartModelId) => void;

/**
 * The smart tester's transport: each check is one messages.create with the settings `get()` gives as it is sent (the
 * key and the model). Every billed answer's usage goes to `onSpend` with the model that answered: the answer's own
 * model when it is one Settings offers, else the one the check asked for (never one chosen while it was out). One that
 * comes after the check's deadline is included, since it is billed all the same. Rejects with no key (nothing sent),
 * or when the call fails; resolves a null verdict for a refusal or an answer that is no verdict (parseVerdict).
 * `opts.fetch` stands in for the network in tests (D20).
 */
export function claudeTransport(get: () => SmartSettings, onSpend: OnSpend,
  opts: { fetch?: typeof fetch } = {}): SmartTransport {
  return async (req) => {
    const { key, model } = get();
    if (key === null) throw new Error('The smart tester has no key.');
    const client = await clientFor(key, opts.fetch);
    const message = await client.messages.create(requestBody(req, model));
    const usage: SmartUsage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
    const answered = SMART_MODELS.find((m) => m.id === message.model)?.id ?? model;
    try {
      onSpend(usage, answered);
    } catch {
      // a spend that can't be saved never costs the line its reading
    }
    return { verdict: parseVerdict(message), usage };
  };
}

/** What Test key found: the key works; it was refused; its organisation refuses browser calls; too many requests; no
 *  connection (or no answer within the budget); the call couldn't get out of this browser though the phone is online
 *  (final review M4: a refused CORS call looks just like no connection); or anything else. */
export type KeyCheck = 'ok' | 'bad-key' | 'browser-blocked' | 'rate-limited' | 'offline' | 'unreachable' | 'error';

/**
 * Tries `key` with `model` in a tiny request (max_tokens 16), and reads the SDK's typed errors, most specific first.
 * APIConnectionError (a timeout among them) comes before APIError, since in the TypeScript SDK it is a subclass. Only
 * the documented CORS message is matched, by its start (D18). A connection error that is no timeout gives only the
 * browser's opaque network error, which a refused CORS preflight gives too: with navigator.onLine true it is
 * 'unreachable', never a claim that the phone is offline (final review M4).
 */
export async function testKey(key: string, model: SmartModelId, opts: { fetch?: typeof fetch } = {}): Promise<KeyCheck> {
  let SDK: typeof Anthropic;
  try {
    SDK = (await loadSdk()).default;
  } catch {
    return 'offline';   // the SDK's own chunk couldn't load: no connection, and not saved for offline use yet
  }
  try {
    const client = await clientFor(key, opts.fetch);
    await client.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }],
      output_config: { effort: 'low' } });
    return 'ok';
  } catch (e) {
    if (e instanceof SDK.APIConnectionTimeoutError) return 'offline';
    if (e instanceof SDK.APIConnectionError) return isOnline() ? 'unreachable' : 'offline';
    if (e instanceof SDK.AuthenticationError) return e.apiMessage?.startsWith(CORS_REFUSED) === true ? 'browser-blocked' : 'bad-key';
    if (e instanceof SDK.RateLimitError) return 'rate-limited';
    return 'error';   // any other APIError, or anything else
  }
}

const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * The run's grader: the keyword grader unless the smart tester is on with a key (smartReady); then a smart grader of its
 * own, so its cache and its cap are this run's. `onSpend` goes to the transport only, which sees every billed answer;
 * the core's `onUsage` stays unset, so no check is counted twice (pre-flight finding 5). `onFailure` hears each failed
 * check (the run toasts once). Offline (navigator.onLine false), a line keeps its keyword reading with no request.
 */
export function graderFor(s: SmartSettings, onSpend: OnSpend, onFailure: () => void,
  opts: { fetch?: typeof fetch } = {}): Grader {
  if (!smartReady(s)) return keywordGrader;
  return smartGrader({ transport: claudeTransport(() => s, onSpend, opts), online: isOnline, onFailure: () => onFailure() });
}
