// Plan 3 Task 5: the Web Speech wrapper (src/voice/speech.ts, rulings D1, D5, D6). A FakeRecognition on
// window.webkitSpeechRecognition records what listen set and called; each test plays Chrome's events in its order.
import { FakeRecognition, lastRecognition, stubSpeech } from './helpers';
import { VOICE_COPY, VOICE_LANGS, listen, voiceSupported, type VoiceError, type VoiceHandlers } from '../../src/voice/speech';

/** Handlers that record every call, in order. */
function recorder() {
  const calls: string[] = [];
  const h: VoiceHandlers = {
    start: () => calls.push('start'),
    interim: (t) => calls.push(`interim:${t}`),
    final: (t) => calls.push(`final:${t}`),
    error: (e) => calls.push(`error:${e}`),
    end: () => calls.push('end'),
  };
  return { h, calls };
}

beforeEach(() => stubSpeech());
afterEach(() => vi.unstubAllGlobals());

describe('voiceSupported', () => {
  it('is false for a window with no recogniser, true with either name', () => {
    expect(voiceSupported({} as Window)).toBe(false);
    expect(voiceSupported({ webkitSpeechRecognition: FakeRecognition } as unknown as Window)).toBe(true);
    expect(voiceSupported({ SpeechRecognition: FakeRecognition } as unknown as Window)).toBe(true);
    expect(voiceSupported()).toBe(true);   // the stubbed window
  });

  it('prefers SpeechRecognition over the prefixed one', () => {
    class Unprefixed extends FakeRecognition {}
    const win = { SpeechRecognition: Unprefixed, webkitSpeechRecognition: FakeRecognition } as unknown as Window;
    listen(recorder().h, win);
    expect(lastRecognition()).toBeInstanceOf(Unprefixed);
  });
});

describe('listen: setup', () => {
  it('is null where there is no recogniser, and makes none', () => {
    expect(listen(recorder().h, {} as Window)).toBeNull();
    expect(FakeRecognition.made).toHaveLength(0);
  });

  it("sets lang 'en-SG', continuous false, interim results and one alternative, then starts once", () => {
    expect(VOICE_LANGS).toEqual(['en-SG', 'en-GB']);
    expect(listen(recorder().h)).not.toBeNull();
    const r = lastRecognition();
    expect(r.lang).toBe('en-SG');
    expect(r.continuous).toBe(false);
    expect(r.interimResults).toBe(true);
    expect(r.maxAlternatives).toBe(1);
    expect(r.calls).toEqual(['start']);
  });

  it('calls start once the mic opens', () => {
    const { h, calls } = recorder();
    listen(h);
    expect(calls).toEqual([]);
    lastRecognition().open();
    expect(calls).toEqual(['start']);
  });
});

describe('listen: results', () => {
  it("an interim result calls interim('buddy do a'); a final one calls final('buddy do a head grip')", () => {
    const { h, calls } = recorder();
    listen(h);
    const r = lastRecognition();
    r.hear('buddy do a', false);
    expect(calls).toEqual(['interim:buddy do a']);
    r.hear('buddy do a head grip', true);
    expect(calls).toEqual(['interim:buddy do a', 'final:buddy do a head grip']);
    r.finish();
    expect(calls.at(-1)).toBe('end');
  });

  it('gives each final once, trimmed, and none for a final with no words', () => {
    const { h, calls } = recorder();
    listen(h);
    const r = lastRecognition();
    r.hear(' sir can you hear me ', true);
    r.hear('  ', true);
    expect(calls).toEqual(['final:sir can you hear me']);
  });

  it('an event that lists an earlier final again from index 0 gives it no second time; its interim still shows', () => {
    const { h, calls } = recorder();
    listen(h);
    const r = lastRecognition();
    r.hear('sir can you hear me', true);
    r.onresult?.({ resultIndex: 0, results: [
      { isFinal: true, length: 1, 0: { transcript: 'sir can you hear me' } },
      { isFinal: false, length: 1, 0: { transcript: 'buddy do' } },
    ] });
    expect(calls).toEqual(['final:sir can you hear me', 'interim:buddy do']);
  });
});

describe('listen: errors', () => {
  const cases: Array<[string, VoiceError]> = [
    ['not-allowed', 'not-allowed'],
    ['service-not-allowed', 'not-allowed'],
    ['network', 'network'],
    ['no-speech', 'no-speech'],
    ['audio-capture', 'audio-capture'],
    ['bad-grammar', 'other'],
    ['phrases-not-supported', 'other'],
  ];
  it.each(cases)("Chrome's %s calls error('%s'), then end once", (code, expected) => {
    const { h, calls } = recorder();
    listen(h);
    lastRecognition().fail(code);
    lastRecognition().finish();
    expect(calls).toEqual([`error:${expected}`, 'end']);
  });

  it("'aborted' calls no error: end only", () => {
    const { h, calls } = recorder();
    listen(h);
    lastRecognition().fail('aborted');
    lastRecognition().finish();
    expect(calls).toEqual(['end']);
  });

  it("'language-not-supported' starts a second recogniser in 'en-GB'; a second one calls error('language')", () => {
    const { h, calls } = recorder();
    listen(h);
    const first = lastRecognition();
    first.open();
    first.fail('language-not-supported');
    first.finish();
    expect(FakeRecognition.made).toHaveLength(2);
    const second = lastRecognition();
    expect(second.lang).toBe('en-GB');
    expect(second.continuous).toBe(false);
    expect(second.interimResults).toBe(true);
    expect(second.calls).toEqual(['start']);
    expect(calls).toEqual(['start']);   // no error and no end yet: the retry is the same listening

    second.open();
    second.fail('language-not-supported');
    second.finish();
    expect(FakeRecognition.made).toHaveLength(2);
    expect(calls).toEqual(['start', 'error:language', 'end']);
  });

  it('the en-GB retry hears like the first', () => {
    const { h, calls } = recorder();
    listen(h);
    lastRecognition().fail('language-not-supported');
    lastRecognition().finish();
    lastRecognition().hear('patient is alert', true);
    lastRecognition().finish();
    expect(calls).toEqual(['final:patient is alert', 'end']);
  });
});

describe('listen: stop and abort', () => {
  it('stop() asks the recogniser to stop (keeping what was heard); abort() aborts it', () => {
    const a = listen(recorder().h)!;
    a.stop();
    expect(lastRecognition().calls).toEqual(['start', 'stop']);
    const b = listen(recorder().h)!;
    b.abort();
    expect(lastRecognition().calls).toEqual(['start', 'abort']);
  });

  it('an abort before the en-GB retry starts makes no second recogniser', () => {
    const { h, calls } = recorder();
    const l = listen(h)!;
    lastRecognition().fail('language-not-supported');
    l.abort();
    lastRecognition().finish();
    expect(FakeRecognition.made).toHaveLength(1);
    expect(calls).toEqual(['end']);
  });

  it('a stop before the en-GB retry starts makes no second recogniser either', () => {
    const { h, calls } = recorder();
    const l = listen(h)!;
    lastRecognition().fail('language-not-supported');
    l.stop();
    expect(lastRecognition().calls).toEqual(['start', 'stop']);
    lastRecognition().finish();
    expect(FakeRecognition.made).toHaveLength(1);
    expect(calls).toEqual(['end']);
  });

  it('after abort() nothing more is heard', () => {
    const { h, calls } = recorder();
    const l = listen(h)!;
    l.abort();
    lastRecognition().hear('buddy', true);
    lastRecognition().fail('aborted');
    lastRecognition().finish();
    expect(calls).toEqual(['end']);
  });

  it('a recogniser whose start throws ends at once with error other', () => {
    class Busy extends FakeRecognition { override start(): void { throw new Error('InvalidStateError'); } }
    const { h, calls } = recorder();
    expect(listen(h, { webkitSpeechRecognition: Busy } as unknown as Window)).not.toBeNull();
    expect(calls).toEqual(['error:other', 'end']);
  });
});

describe('VOICE_COPY', () => {
  it('says what happened and what to do, in the plain voice', () => {
    expect(VOICE_COPY).toEqual({
      'not-allowed': "EMTNotes can't use the mic. Allow it in Chrome's site settings, or type instead.",
      network: 'Voice needs a connection right now. Type instead.',
      'no-speech': "Didn't catch that. Tap the mic and try again.",
      'audio-capture': 'No mic found on this phone. Type instead.',
      language: "Chrome can't take speech in English here. Type instead.",
      other: 'Voice stopped. Tap the mic to try again.',
    });
  });
});
