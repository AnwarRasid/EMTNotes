// @vitest-environment node
// Plan 3 Task 9: the smart tester's Claude transport (src/smart/claude.ts). The SDK doesn't run under jsdom, so this
// file runs in Node, and every call goes to a fetch injected through the SDK's own `fetch` option (D20): no test makes a
// network call. It pins what is sent (D13, D17, D19), where and with which headers (D18), how an answer becomes a
// verdict, and how Test key reads the SDK's typed errors.
import { CASES, ctxAt } from './sim-helpers';
import type { SentenceReading } from '../../src/sim/grader';
import { smartRequest, type SmartRequest, type SmartVerdict } from '../../src/sim/smart';
import {
  SMART_SYSTEM, claudeTransport, graderFor, parseVerdict, requestBody, testKey, verdictSchema,
} from '../../src/smart/claude';
import { DEFAULT_SMART, SMART_MODELS, withSpend, type SmartSettings } from '../../src/smart/settings';

const KEY = 'sk-ant-test';
const hypo = CASES.find((c) => c.id === 'hypo-hougang-01')!;
const ctx = ctxAt('delicate-spine', 'hypo-hougang-01');
/** One unread sentence that says the case's name, call name, IC and address all at once. */
const SAID = `${hypo.patient.callName} ${hypo.patient.name.split(' ').slice(1).join(' ')}, ${hypo.patient.ic}, any ouch at your nape at ${hypo.location}?`;
const sentence = (text: string): SentenceReading => ({ text, step: null, addressee: null, points: [], oxygen: null, ecg: null });
const req: SmartRequest = smartRequest(ctx, [sentence('Any wheeze?'), sentence(SAID)], [1]);
const ready: SmartSettings = { ...DEFAULT_SMART, on: true, key: KEY };
const NECK = 'delicate-spine/ask-neck-pain';

/** Walks into a JSON value by property names. */
function dig(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((at, k) => (typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[k] : undefined), value);
}

/** A Messages API response: `text` as its one text block (none for null), with `over` on top. */
function messageResponse(text: string | null, over: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: text === null ? [] : [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 40 }, ...over,
  }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
}
const errorResponse = (status: number, type: string, message: string): Response =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json' } });

interface Sent { url: string; method: string; headers: Headers; body: unknown }
/** A fetch that records each request it is given and answers it with `answer()`. */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const r = new Request(input, init);
    const text = await r.text();
    sent.push({ url: r.url, method: r.method, headers: r.headers, body: text === '' ? null : JSON.parse(text) });
    return answer();
  });
  return { sent, fetch };
}
const verdict: SmartVerdict = { sentences: [{ index: 1, points: [{ key: NECK, parts: [] }] }] };

describe('requestBody (D13, D17, D19)', () => {
  const body = requestBody(req, 'claude-opus-5-5');

  it('asks Opus 5.5 at low effort for a json_schema answer, in 2048 tokens, with no thinking field', () => {
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(2048);
    expect(body.output_config?.effort).toBe('low');
    expect(body.output_config?.format?.type).toBe('json_schema');
    expect(body.system).toBe(SMART_SYSTEM);
    expect('thinking' in body).toBe(false);
    expect(body.messages).toEqual([{ role: 'user', content: JSON.stringify(req) }]);
  });

  it("limits the answer's keys to the candidates' keys, and allows no other property", () => {
    const schema = body.output_config?.format?.schema;
    expect(schema).toEqual(verdictSchema(req));
    const point = dig(schema, 'properties', 'sentences', 'items', 'properties', 'points', 'items');
    expect(dig(point, 'properties', 'key', 'enum')).toEqual(req.candidates.map((c) => c.key));
    expect(req.candidates.map((c) => c.key)).toContain(NECK);
    expect(dig(schema, 'additionalProperties')).toBe(false);
    expect(dig(schema, 'properties', 'sentences', 'items', 'additionalProperties')).toBe(false);
    expect(dig(point, 'additionalProperties')).toBe(false);
    expect(dig(schema, 'properties', 'sentences', 'items', 'properties', 'index', 'enum')).toEqual([1]);   // the sentences sent
  });

  it("holds none of the case's IC, name, call name or location, only the masked sentence", () => {
    const sent = JSON.stringify(body);
    for (const value of [hypo.patient.ic, hypo.patient.name, hypo.patient.callName, hypo.location, hypo.area]) {
      expect(sent).not.toContain(value);
    }
    expect(sent.toLowerCase()).not.toContain(hypo.patient.ic.toLowerCase());
    expect(req.sentences).toEqual([{ index: 1, text: 'the patient, the IC, any ouch at your nape at the address?' }]);
    expect(sent).not.toContain('Any wheeze?');   // a sentence the keyword rules read is never sent
  });

  it('is the same shape for every model offered, with no betas and no fallbacks (D19)', () => {
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'system']);
    for (const m of SMART_MODELS) {
      const b = requestBody(req, m.id);
      expect(b.model).toBe(m.id);
      expect(Object.keys(b).sort()).toEqual(keys);
      expect(Object.keys(b)).not.toContain('betas');
      expect(Object.keys(b)).not.toContain('fallbacks');
    }
  });
});

describe('parseVerdict', () => {
  const msg = (text: string | undefined, stop: string | null = 'end_turn') =>
    ({ stop_reason: stop, content: text === undefined ? [] : [{ type: 'text', text }] });

  it("reads the text block's JSON as the verdict, past any other block", () => {
    expect(parseVerdict(msg(JSON.stringify(verdict)))).toEqual(verdict);
    expect(parseVerdict({ stop_reason: 'end_turn', content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(verdict) }] }))
      .toEqual(verdict);
  });

  it('is null on a refusal, no text block, text that is no JSON, or a shape that is no verdict', () => {
    expect(parseVerdict(msg(JSON.stringify(verdict), 'refusal'))).toBeNull();
    expect(parseVerdict(msg(undefined))).toBeNull();
    expect(parseVerdict(msg('Sentence 1 asks about neck pain.'))).toBeNull();
    expect(parseVerdict(msg('{"points":[]}'))).toBeNull();
    expect(parseVerdict(msg('{"sentences":[{"index":"one","points":[]}]}'))).toBeNull();
    expect(parseVerdict(msg('{"sentences":[{"index":1.5,"points":[]}]}'))).toBeNull();
    expect(parseVerdict(msg('{"sentences":[{"index":1,"points":[{"key":7,"parts":[]}]}]}'))).toBeNull();
  });
});

/** The key as the SDK's auth header carries it: SDK 1.x (API version 2026-10-21) sends every API key as a bearer
 *  token, never as x-api-key (the claude-api skill's api-version notes). */
const authOf = (call: Sent | undefined) => ({ authorization: call?.headers.get('authorization'), xApiKey: call?.headers.get('x-api-key') });

describe('claudeTransport (D18, D20)', () => {
  it("posts to https://api.anthropic.com/v1/messages, the key only in the SDK's auth header, with the browser header and no beta", async () => {
    const { sent, fetch } = fakeFetch(() => messageResponse(JSON.stringify(verdict)));
    await claudeTransport(() => ready, () => {}, { fetch })(req);
    expect(sent).toHaveLength(1);
    const [call] = sent;
    expect(call!.method).toBe('POST');
    expect(call!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(authOf(call)).toEqual({ authorization: `Bearer ${KEY}`, xApiKey: null });
    expect(call!.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(call!.headers.get('anthropic-beta')).toBeNull();
    const elsewhere = [...call!.headers.entries()].filter(([k, value]) => k !== 'authorization' && value.includes(KEY));
    expect(elsewhere).toEqual([]);
    expect(call!.body).toEqual(requestBody(req, 'claude-opus-5-5'));
    const body = JSON.stringify(call!.body);
    expect(body).not.toContain(KEY);
    for (const value of [hypo.patient.ic, hypo.patient.name, hypo.patient.callName, hypo.location]) expect(body).not.toContain(value);
  });

  it('sends the chosen model', async () => {
    const { sent, fetch } = fakeFetch(() => messageResponse(JSON.stringify(verdict)));
    await claudeTransport(() => ({ ...ready, model: 'claude-haiku-5-5' }), () => {}, { fetch })(req);
    expect(dig(sent[0]!.body, 'model')).toBe('claude-haiku-5-5');
  });

  it("returns the text block's verdict with the usage, and gives the usage to onSpend", async () => {
    const { fetch } = fakeFetch(() => messageResponse(JSON.stringify(verdict)));
    const onSpend = vi.fn();
    const res = await claudeTransport(() => ready, onSpend, { fetch })(req);
    expect(res).toEqual({ verdict, usage: { inputTokens: 900, outputTokens: 40 } });
    expect(onSpend).toHaveBeenCalledTimes(1);
    expect(onSpend).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 40 }, 'claude-opus-5-5');
  });

  it('gives onSpend the model that answered, not the one chosen while the check was out (review M6)', async () => {
    let settings: SmartSettings = { ...ready, model: 'claude-opus-5-5' };
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { fetch } = fakeFetch(async () => { await gate; return messageResponse(JSON.stringify(verdict)); });
    const onSpend = vi.fn();
    const pending = claudeTransport(() => settings, onSpend, { fetch })(req);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    settings = { ...settings, model: 'claude-haiku-5-5' };   // changed in Settings while the check is out
    release();
    await pending;
    expect(onSpend).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 40 }, 'claude-opus-5-5');
  });

  it("names the answer's own model when the API reports one it offers", async () => {
    const { fetch } = fakeFetch(() => messageResponse(JSON.stringify(verdict), { model: 'claude-sonnet-5-5' }));
    const onSpend = vi.fn();
    await claudeTransport(() => ready, onSpend, { fetch })(req);
    expect(onSpend).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 40 }, 'claude-sonnet-5-5');
  });

  it.each([
    ['a refusal', () => messageResponse(JSON.stringify(verdict), { stop_reason: 'refusal' })],
    ['a text that is no JSON', () => messageResponse('I think sentence 1 is about the neck.')],
    ['a verdict missing sentences', () => messageResponse('{"points":[]}')],
  ])('%s is a null verdict, still billed', async (_, answer) => {
    const { fetch } = fakeFetch(answer);
    const onSpend = vi.fn();
    const res = await claudeTransport(() => ready, onSpend, { fetch })(req);
    expect(res.verdict).toBeNull();
    expect(res.usage).toEqual({ inputTokens: 900, outputTokens: 40 });
    expect(onSpend).toHaveBeenCalledTimes(1);
  });

  it('rejects, sending nothing, with no key; and rejects on an API error or no connection', async () => {
    const none = fakeFetch(() => messageResponse('{}'));
    await expect(claudeTransport(() => ({ ...ready, key: null }), () => {}, { fetch: none.fetch })(req)).rejects.toThrow();
    expect(none.fetch).not.toHaveBeenCalled();
    const bad = fakeFetch(() => errorResponse(500, 'api_error', 'Internal server error'));
    await expect(claudeTransport(() => ready, () => {}, { fetch: bad.fetch })(req)).rejects.toThrow();
    expect(bad.fetch).toHaveBeenCalledTimes(1);   // maxRetries 0
    const offline = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch'); });
    await expect(claudeTransport(() => ready, () => {}, { fetch: offline })(req)).rejects.toThrow();
    expect(offline).toHaveBeenCalledTimes(1);
  });
});

describe('testKey', () => {
  it.each([
    ['200', () => messageResponse('OK'), 'ok'],
    ['401 CORS for the organisation', () => errorResponse(401, 'authentication_error',
      'CORS requests are not allowed for this Organization because of its settings. Contact your administrator.'), 'browser-blocked'],
    ['401 another message', () => errorResponse(401, 'authentication_error', 'invalid x-api-key'), 'bad-key'],
    ['429', () => errorResponse(429, 'rate_limit_error', 'Number of requests has exceeded your rate limit.'), 'rate-limited'],
    ['500', () => errorResponse(500, 'api_error', 'Internal server error'), 'error'],
    ['403', () => errorResponse(403, 'permission_error', 'Your API key does not have permission.'), 'error'],
  ] as const)('%s reads %s', async (_, answer, result) => {
    const { sent, fetch } = fakeFetch(answer);
    expect(await testKey(KEY, 'claude-sonnet-5-5', { fetch })).toBe(result);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(authOf(sent[0])).toEqual({ authorization: `Bearer ${KEY}`, xApiKey: null });
    expect(sent[0]!.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(dig(sent[0]!.body, 'model')).toBe('claude-sonnet-5-5');
    expect(dig(sent[0]!.body, 'max_tokens')).toBe(16);
    expect(JSON.stringify(sent[0]!.body)).not.toContain(KEY);
  });

  // Final review M4: the browser gives a refused CORS call and no connection the same opaque network error. Offline
  // (navigator.onLine false) it is no connection; online it is "couldn't reach Anthropic from this browser", never a
  // claim that you're offline. A timeout is still a connection that didn't answer.
  // Node's navigator has no onLine (the transport reads a missing one as online): each of these sets its own
  const onLine = (value: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  afterEach(() => { Reflect.deleteProperty(navigator, 'onLine'); });
  it('a fetch rejecting with a TypeError while the phone is offline reads offline', async () => {
    onLine(false);
    const offline = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch'); });
    expect(await testKey(KEY, 'claude-opus-5-5', { fetch: offline })).toBe('offline');
  });

  it('the same opaque error while the phone is online reads unreachable (a refused CORS call looks like this)', async () => {
    onLine(true);
    const refused = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch'); });
    expect(await testKey(KEY, 'claude-opus-5-5', { fetch: refused })).toBe('unreachable');
  });

  it('a call that times out reads offline, online or not', async () => {
    onLine(true);
    const slow = vi.fn(async (): Promise<Response> => { throw new Error('Request timed out'); });
    expect(await testKey(KEY, 'claude-opus-5-5', { fetch: slow })).toBe('offline');
  });
});

describe('graderFor', () => {
  it('is the keyword grader unless the smart tester is on with a key', () => {
    expect(graderFor(DEFAULT_SMART, () => {}, () => {}).id).toBe('keywords');
    expect(graderFor({ ...DEFAULT_SMART, on: true }, () => {}, () => {}).id).toBe('keywords');
    expect(graderFor({ ...DEFAULT_SMART, key: KEY }, () => {}, () => {}).id).toBe('keywords');
    expect(graderFor(ready, () => {}, () => {}).id).toBe('smart');
  });

  it('one billed response raises the checks by exactly 1: onSpend is wired once (pre-flight finding 5)', async () => {
    const { sent, fetch } = fakeFetch(() => messageResponse(JSON.stringify({ sentences: [] })));
    let s = ready;
    const g = graderFor(ready, (u, model) => { s = withSpend(s, u, model); }, () => {}, { fetch });
    await g.interpret('Mr Lim, any ouch at your nape?', ctx);
    expect(sent).toHaveLength(1);
    expect(s.checks).toBe(1);
    expect(s.spentUsd).toBeCloseTo((900 * 4 + 40 * 20) / 1_000_000, 12);
  });

  it('a refused line calls onFailure and keeps the keyword reading', async () => {
    const { fetch } = fakeFetch(() => messageResponse(JSON.stringify(verdict), { stop_reason: 'refusal' }));
    const onFailure = vi.fn();
    const g = graderFor(ready, () => {}, onFailure, { fetch });
    const read = await g.interpret('Mr Lim, any ouch at your nape?', ctx);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(read.sentences.every((x) => x.smart === undefined && x.points.length === 0)).toBe(true);
  });
});
