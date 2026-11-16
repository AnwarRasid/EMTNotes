// Valibot schemas for every content file, and the types the app reads them as.
// Generated files (questions.json, notes.json) use v.object; hand-written files (overrides, steps, cases)
// use v.strictObject, so a misspelt key fails instead of being dropped.
import * as v from 'valibot';

// ---- Shared keys ----------------------------------------------------------------------------------------

export const TOPICS = { respiratory: 'Respiratory', cardiac: 'Cardiac', trauma: 'Trauma', burns: 'Burns', shock: 'Shock',
  neuro: 'Neuro', diabetic: 'Diabetic', drugs: 'Drugs', airway: 'Airway', assessment: 'Assessment', iv: 'IV',
  ops: 'Ops and conduct', hmls: 'HMLS' } as const;
export type Topic = keyof typeof TOPICS;
export const TopicSchema = v.picklist(Object.keys(TOPICS) as [Topic, ...Topic[]]);

export const BankIdSchema = v.picklist(['mt-a', 'mt-b', 'hmls']);
export type BankId = v.InferOutput<typeof BankIdSchema>;

/** A section id with an optional heading anchor: `s07`, `s01#delicate-spine`. */
export const NOTES_REF = /^s\d{2}(#[a-z0-9-]+)?$/;
export const NotesRefSchema = v.pipe(v.string(), v.regex(NOTES_REF));
export type NotesRef = v.InferOutput<typeof NotesRefSchema>;

const SrcHashSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{12}$/));

// ---- questions.json (generated, Task 3) -----------------------------------------------------------------

const RawQuestionSchema = v.pipe(
  v.object({
    id: v.string(),
    bank: BankIdSchema,
    number: v.number(),
    passage: v.nullable(v.string()),
    stem: v.string(),
    options: v.pipe(v.array(v.object({ id: v.string(), label: v.string(), text: v.string() })), v.minLength(2), v.maxLength(6)),
    // null only on a question flagged for review (a non-empty `review` is the spec's needsReview)
    answer: v.nullable(v.string()),
    image: v.nullable(v.string()),
    topic: v.nullable(TopicSchema),
    review: v.array(v.object({ code: v.string(), reason: v.string() })),
    srcHash: SrcHashSchema,
  }),
  v.forward(
    v.check(
      q => (q.answer === null ? q.review.length > 0 : q.options.some(o => o.id === q.answer)),
      'The answer must be one of the option ids, or null on a question flagged for review.',
    ),
    ['answer'],
  ),
);
export type RawQuestion = v.InferOutput<typeof RawQuestionSchema>;

export const RawQuestionsDocSchema = v.object({
  contentVersion: v.string(),
  banks: v.array(v.object({ id: BankIdSchema, label: v.string(), source: v.string() })),
  questions: v.array(RawQuestionSchema),
});
export type RawQuestionsDoc = v.InferOutput<typeof RawQuestionsDocSchema>;

// ---- overrides.json (hand-written, Tasks 9-11) ----------------------------------------------------------

export const OverrideEntrySchema = v.strictObject({
  srcHash: SrcHashSchema,
  topic: TopicSchema,
  explanation: v.pipe(v.string(), v.minLength(1)),
  notesRef: v.nullable(NotesRefSchema),
  generated: v.boolean(),
  review: v.optional(v.string()),
});
export type OverrideEntry = v.InferOutput<typeof OverrideEntrySchema>;

export const OverridesDocSchema = v.strictObject({
  version: v.literal(1),
  questions: v.record(v.string(), OverrideEntrySchema),
});
export type OverridesDoc = v.InferOutput<typeof OverridesDocSchema>;

// ---- notes.json (generated, Task 5) ---------------------------------------------------------------------

const RunSchema = v.object({
  t: v.string(),
  b: v.optional(v.literal(true)),
  i: v.optional(v.literal(true)),
  u: v.optional(v.literal(true)),
  h: v.optional(v.literal(true)),
});
export type Run = v.InferOutput<typeof RunSchema>;

// Recursive (tables and boxes hold blocks), so the type is written by hand.
export type Block =
  | { k: 'h'; id: string; text: string; group?: true; runs?: Run[] }   // runs only when the heading has a highlight
  | { k: 'p'; runs: Run[] }
  | { k: 'list'; items: { depth: 1 | 2; marker: string; runs: Run[] }[] }
  | { k: 'table'; rows: { header: boolean; cells: Block[][] }[] }
  | { k: 'box'; variant: 'remark' | 'added'; title: string; blocks: Block[] }
  | { k: 'img'; src: string; alt: string };

const BlockSchema: v.GenericSchema<Block> = v.lazy(() =>
  v.variant('k', [
    v.object({ k: v.literal('h'), id: v.string(), text: v.string(), group: v.optional(v.literal(true)), runs: v.optional(v.array(RunSchema)) }),
    v.object({ k: v.literal('p'), runs: v.array(RunSchema) }),
    v.object({ k: v.literal('list'), items: v.array(v.object({ depth: v.picklist([1, 2]), marker: v.string(), runs: v.array(RunSchema) })) }),
    v.object({ k: v.literal('table'), rows: v.array(v.object({ header: v.boolean(), cells: v.array(v.array(BlockSchema)) })) }),
    v.object({ k: v.literal('box'), variant: v.picklist(['remark', 'added']), title: v.string(), blocks: v.array(BlockSchema) }),
    v.object({ k: v.literal('img'), src: v.string(), alt: v.string() }),
  ]),
);

const SectionSchema = v.object({
  id: v.string(),
  n: v.number(),
  title: v.string(),
  tags: v.array(v.string()),
  highlights: v.number(),
  blocks: v.array(BlockSchema),
});
export type Section = v.InferOutput<typeof SectionSchema>;

export const NotesDocSchema = v.object({
  contentVersion: v.string(),
  source: v.literal('EMT_Survey_Notes.docx'),
  sections: v.array(SectionSchema),
});
export type NotesDoc = v.InferOutput<typeof NotesDocSchema>;

// ---- steps.json (hand-written, Task 7) ------------------------------------------------------------------

export const ROLES = ['opsCtr', 'caller', 'patient', 'headBuddy', 'armBuddy', 'tester'] as const;
export type Role = (typeof ROLES)[number];
export type Addressee = Role | 'crew';

export const CASE_FLAGS = ['rta', 'unconscious', 'spinal', 'spinalAfterRbs', 'limbInjury', 'asthmaCopd', 'hypoglycaemia', 'extraPpe'] as const;
/** stayAndTreat and loadAndGo are the case's own plan (expected.decision.plan), which step 18's two plan points read, so
 *  a medical case can Load & Go (Plan 3 D21); in the eight Plan 2 cases they hold where medical and trauma do. */
export const CONDITIONS = [...CASE_FLAGS, 'medical', 'trauma', 'noSpinal', 'neckPain', 'catastrophicBleeding', 'positionNotIdeal',
  'stayAndTreat', 'loadAndGo'] as const;
export type CaseFlag = (typeof CASE_FLAGS)[number];
export type Condition = (typeof CONDITIONS)[number];

export const VITAL_KEYS = ['spo2', 'pr', 'rr', 'bp', 'temp', 'skin', 'crt'] as const;
export type VitalKey = (typeof VITAL_KEYS)[number];

/** Slots a match term may hold, as '{age}'; the matcher fills them from the case (lowercase, as every term is). The last
 *  six are the same for every case: gcstotal, any GCS total from 3 to 15, so the score reads the figure the trainee
 *  states and never needs the case's own (R15, ruling P21); gcse, gcsv and gcsm, the E, V and M figures in range (e1–e4,
 *  v1–v5, m1–m6), which a GCS part pairs with "gcs" or a sibling figure (final review N3); raceword, the four race
 *  words, which anchor the SRACIE's F and M (final review N2); and gcsscore, the totals 11 to 15, which a lone "score"
 *  may state, as no 1-to-10 pain score reaches them (Plan 3 ruling D24). */
export const MATCH_SLOTS = ['age', 'decade', 'ic', 'eta', 'bparm', 'posture', 'gcstotal', 'gcse', 'gcsv', 'gcsm', 'raceword', 'gcsscore'] as const;
export type MatchSlot = (typeof MATCH_SLOTS)[number];
/**
 * Slots a canonical line may hold, as '{bpArm}'; tap mode fills them from the case before playing the line.
 * positionAdvice is step 17's advice in the case's own direction (findings.position.toward), and empty where the
 * position is ideal, so fillCanonical leaves its sentence out. decisionLine is step 18's decision sentence for the case's
 * plan (expected.decision.plan), from notes s01. limbWhere is the injured limb (findings.rbs.limb.where, "right leg"),
 * which step 12's immobilise say names, and empty in a case with no limb injury (Plan 3 D22). A line may also hold
 * {say:<pointId>} (SAY_SLOT, below), and a say may hold any of these slots.
 */
export const CANONICAL_SLOTS = ['location', 'callText', 'chiefComplaint', 'suspected', 'signs', 'sex', 'race', 'age', 'ic', 'eta', 'bpArm',
  'positionAdvice', 'decisionLine', 'callExtras', 'limbWhere'] as const;
/**
 * A canonical line's placeholder for a conditional point's own words, as a regex source: '{say:c-collar}' (Task 11b).
 * fillCanonical puts in the point's `say` where its `when` holds for the case, and drops the placeholder elsewhere. The
 * step's schema check (sayIssues) keeps each one a sentence or two of its own, naming a point of its step.
 */
export const SAY_SLOT = '\\{say:([^{}]*)\\}';
export const OXYGEN_DEVICES = ['nasal-cannula', 'simple-face-mask', 'non-rebreather', 'nebuliser-mask', 'bvm', 'none'] as const;
export type OxygenDevice = (typeof OXYGEN_DEVICES)[number];
/** The patient's voiced answers; each case writes every one, in the patient's own voice. */
export const PATIENT_LINES = ['feelingNow', 'fall', 'hitHead', 'neckPain', 'lungHistory', 'verbal', 'motor', 'severity', 'position', 'bpScreen', 'ic'] as const;
export type PatientLine = (typeof PATIENT_LINES)[number];

const RoleSchema = v.picklist(ROLES);
const ConditionSchema = v.picklist(CONDITIONS);

// An empty or blank term, or an empty alternative, would match (nearly) every answer, so they are rejected. Padded
// terms are rejected too: word boundaries belong in the matcher, not in the terms. Terms in match, local, requiredWords
// and negatives follow the same rules. Braces only ever hold a match slot ('{age}'), which the matcher fills per case.
const MATCH_SLOT_TERM = new RegExp(`\\{(?:${MATCH_SLOTS.join('|')})\\}`, 'g');
const MatchTermSchema = v.pipe(
  v.string(),
  v.minLength(1, 'A match term must not be empty.'),
  v.check(t => t.trim() === t, 'A match term must not start or end with whitespace.'),
  v.check(t => t === t.toLowerCase(), 'A match term must be lowercase.'),
  v.check(t => !/[{}]/.test(t.replace(MATCH_SLOT_TERM, '')), `A match term may hold braces only as a slot: ${MATCH_SLOTS.map(s => `{${s}}`).join(', ')}.`),
);
/** Any alternative may match; every term in an alternative must appear (lowercase; stems allowed, e.g. "deformit"). */
const MatchSchema = v.array(v.pipe(v.array(MatchTermSchema), v.minLength(1, 'A match alternative needs at least one term.')));
export type Match = v.InferOutput<typeof MatchSchema>;

const PartSchema = v.strictObject({ id: v.string(), label: v.string(), match: MatchSchema });
export type Part = v.InferOutput<typeof PartSchema>;

// A conditional point's words, as the trainee says them (notes s01): a sentence or two, filled into the canonical line
// as written, so it ends a sentence. Its only braces are canonical slots ("Buddy, immobilise the {limbWhere}.", Plan 3
// D22), which fillCanonical fills from the case as it does the line's own; no {say:…} and no match slot.
const CANONICAL_SLOT_TERM = new RegExp(`\\{(?:${CANONICAL_SLOTS.join('|')})\\}`, 'g');
const SaySchema = v.pipe(
  v.string(),
  v.minLength(1, 'A say must not be empty.'),
  v.check(t => t.trim() === t, 'A say must not start or end with whitespace.'),
  v.check(t => /[.?!]$/.test(t), 'A say ends a sentence: a full stop, question mark or exclamation mark last.'),
  v.check(t => !/[{}]/.test(t.replace(CANONICAL_SLOT_TERM, '')),
    `A say may hold braces only as a canonical slot: ${CANONICAL_SLOTS.map(s => `{${s}}`).join(', ')}.`),
);

const MustHitSchema = v.pipe(
  v.strictObject({
    id: v.string(),
    label: v.string(),
    short: v.pipe(v.string(), v.minLength(1, 'A short label must not be empty.'), v.maxLength(28, 'A short label fits in 28 characters.')),
    match: MatchSchema,
    local: v.optional(MatchSchema),   // alternatives that count only while this point's step is the run's current step
    parts: v.optional(v.array(PartSchema)),
    ordered: v.optional(v.literal(true)),
    keyPhrase: v.optional(v.literal(true)),
    requiredWords: v.optional(v.array(MatchTermSchema)),
    negatives: v.optional(v.array(MatchTermSchema)),
    accept: v.optional(v.array(v.strictObject({ label: v.string(), match: MatchSchema }))),
    when: v.optional(ConditionSchema),
    // what the canonical line says for the point where `when` holds ({say:<pointId>}, Task 11b)
    say: v.optional(SaySchema),
    to: v.optional(v.picklist([...ROLES, 'crew'] as const)),
    // whether the point is right depends on the oxygen, the ECG or the BP arm chosen (the arm: Plan 3 ruling D23)
    check: v.optional(v.picklist(['oxygen', 'ecg', 'arm'])),
  }),
  v.check(m => m.match.length > 0 || (m.local?.length ?? 0) > 0 || (m.parts?.length ?? 0) > 0,
    'A must-hit point needs match terms, local terms or parts.'),
  v.check(m => m.say === undefined || m.when !== undefined,
    'A say is only for a point with a when: the canonical line says it only where the point applies.'),
);
export type MustHit = v.InferOutput<typeof MustHitSchema>;

// `on` names what triggers a reply: must-hit ids of its step, or 'pointId.partId' for one part.
const OnSchema = v.pipe(v.array(v.string()), v.minLength(1, 'A reply needs at least one trigger.'));
const ReplySchema = v.union([
  v.strictObject({ role: RoleSchema, text: v.string(), on: OnSchema }),
  v.strictObject({ role: RoleSchema, finding: v.string(), on: OnSchema }),       // a getFinding path, e.g. "findings.airway.mouth"
  v.strictObject({ role: RoleSchema, vitals: v.array(v.picklist(VITAL_KEYS)), on: OnSchema }),
  v.strictObject({ role: RoleSchema, computed: v.picklist(['eta', 'ic', 'oxygen']), on: OnSchema }),
]);
export type Reply = v.InferOutput<typeof ReplySchema>;

/** The reply triggers of a step that name no must-hit point of that step, nor 'point.part' for one of its parts. */
function unresolvedTriggers(s: { mustHit: MustHit[]; replies: Reply[] }): string[] {
  const resolves = (on: string) => {
    const [pid, part, ...rest] = on.split('.');
    const m = s.mustHit.find(p => p.id === pid);
    return m !== undefined && rest.length === 0 && (part === undefined || (m.parts ?? []).some(p => p.id === part));
  };
  return s.replies.flatMap(r => r.on).filter(on => !resolves(on));
}

/** Text before a placeholder that leaves it a sentence of its own: none, a sentence's end, or another say placeholder,
 *  then a space. */
const SAY_AT_START = new RegExp(`(?:^|[.?!]\\s+|${SAY_SLOT}\\s+)$`);
/** Text after a placeholder that leaves it a sentence of its own: none, or a space and then the start of the next
 *  sentence: a capital, a digit, another say placeholder, or a canonical slot (step 18's "{decisionLine} As I am…"). A
 *  lowercase word would finish the placeholder's sentence ("{say:c-collar} now." fills as "… C-collar. now.") (Task 11b
 *  review round 1). */
const SAY_AT_END = new RegExp(`^(?:$|\\s+(?:[A-Z0-9]|${SAY_SLOT}|\\{(?:${CANONICAL_SLOTS.join('|')})\\}))`);
/**
 * What is wrong with a step's {say:<pointId>} placeholders (Task 11b), one message each; none when all is well. Each
 * names a must-hit point of its own step that has a `when` and a `say`, once, and stands as its own sentence or
 * sentences: at the line's start, or after a sentence's end or another placeholder (SAY_AT_START); and at the line's
 * end, or before the start of the next sentence (SAY_AT_END).
 * Every point of the step with a `when` and a `say` has one.
 */
function sayIssues(s: { canonicalLine: string; mustHit: MustHit[] }): string[] {
  const line = s.canonicalLine;
  const issues: string[] = [];
  const uses = new Map<string, number>();
  for (const m of line.matchAll(new RegExp(SAY_SLOT, 'g'))) {
    const id = m[1] ?? '';
    const at = m.index ?? 0;
    uses.set(id, (uses.get(id) ?? 0) + 1);
    const point = s.mustHit.find(p => p.id === id);
    if (point === undefined) issues.push(`{say:${id}} names no must-hit point of its step`);
    else if (point.when === undefined) issues.push(`{say:${id}} names a point with no when`);
    else if (point.say === undefined) issues.push(`{say:${id}} names a point with no say`);
    if (!SAY_AT_START.test(line.slice(0, at)) || !SAY_AT_END.test(line.slice(at + m[0].length))) {
      issues.push(`{say:${id}} must stand as its own sentence`);
    }
  }
  for (const [id, n] of uses) if (n > 1) issues.push(`{say:${id}} is used ${n} times`);
  for (const p of s.mustHit) {
    if (p.when !== undefined && p.say !== undefined && !uses.has(p.id)) issues.push(`${p.id} has a say but no {say:${p.id}} in the canonical line`);
  }
  return issues;
}

const StepSchema = v.pipe(
  v.strictObject({
    id: v.string(),
    order: v.number(),
    name: v.string(),
    timed: v.boolean(),
    startsClock: v.optional(v.literal(true)),
    inOrder: v.optional(v.literal(true)),
    notesRef: NotesRefSchema,
    canonicalLine: v.string(),
    mustHit: v.array(MustHitSchema),
    replies: v.array(ReplySchema),
    guidance: v.array(v.string()),
    branches: v.optional(v.array(v.strictObject({ if: ConditionSchema, note: v.string() }))),
  }),
  // a misspelt trigger would load and the reply would never play, so it fails here
  v.forward(
    v.check(
      s => unresolvedTriggers(s).length === 0,
      issue => `A reply trigger must name a must-hit point of its step, or 'point.part' for one of its parts: ${unresolvedTriggers(issue.input).join(', ')}.`,
    ),
    ['replies'],
  ),
  // a placeholder naming no say would leave a brace in tap mode's line, and a say with no placeholder is never said
  v.forward(
    v.check(
      s => sayIssues(s).length === 0,
      issue => `Each {say:<pointId>} must name a conditional point of its step that has a say, once, as a sentence of its own: ${sayIssues(issue.input).join('; ')}.`,
    ),
    ['canonicalLine'],
  ),
);
export type Step = v.InferOutput<typeof StepSchema>;

export const StepsDocSchema = v.strictObject({ contentVersion: v.string(), steps: v.array(StepSchema) });
export type StepsDoc = v.InferOutput<typeof StepsDocSchema>;

// ---- cases/*.json (hand-written, Task 8) ----------------------------------------------------------------

const CaseTypeSchema = v.picklist(['medical', 'trauma']);

const VitalsSchema = v.strictObject({
  spo2: v.number(), pr: v.number(), rr: v.number(), bp: v.string(), temp: v.number(), skin: v.string(), crt: v.string(),
});
export type Vitals = v.InferOutput<typeof VitalsSchema>;

export const CaseSchema = v.pipe(
  v.strictObject({
    id: v.string(),
    type: CaseTypeSchema,
    complaint: v.string(),
    area: v.string(),
    callText: v.string(),
    location: v.string(),
    flags: v.array(v.picklist(CASE_FLAGS)),
    reviewed: v.boolean(),
    notesRef: NotesRefSchema,
    caller: v.strictObject({
      who: v.string(),
      voice: v.string(),
      answers: v.strictObject({
        location: v.string(), whatHappened: v.string(), casualties: v.string(), conscious: v.string(), icAndMeds: v.string(),
        breathing: v.optional(v.string()), criticalInjuries: v.optional(v.string()), vehicles: v.optional(v.string()),
      }),
    }),
    patient: v.strictObject({
      name: v.string(),
      callName: v.string(),   // how the crew addresses the patient, e.g. 'Mdm Tan'
      sex: v.picklist(['male', 'female']),
      race: v.string(),
      age: v.number(),
      ic: v.pipe(v.string(), v.regex(/^[STFG]\d{2}x{5}[A-Z]$/)),   // masked, e.g. S54xxxxxA
      voice: v.string(),
      chiefComplaint: v.string(),
      lines: v.strictObject({
        ...(Object.fromEntries(PATIENT_LINES.map(k => [k, v.string()])) as Record<PatientLine, v.StringSchema<undefined>>),
        convinced: v.optional(v.string()),   // only where the position is not ideal: the patient agrees to change
      }),
    }),
    findings: v.strictObject({
      scene: v.strictObject({ description: v.string(), items: v.array(v.string()), hazards: v.array(v.string()), witnesses: v.string() }),
      approach: v.strictObject({
        catastrophicBleeding: v.boolean(),
        bleeding: v.string(),   // what the tester says when asked, e.g. 'No catastrophic bleeding.'
        control: v.optional(v.strictObject({ pressure: v.string(), dressing: v.string(), cat: v.string() })),   // bleed cases only
      }),
      loc: v.strictObject({ avpu: v.picklist(['A', 'V', 'P', 'U']), response: v.string() }),
      spine: v.strictObject({ fall: v.string(), hitHead: v.string(), dtbl: v.string(), neckPain: v.boolean() }),
      airway: v.strictObject({ mouth: v.string(), smell: v.string() }),
      breathing: v.strictObject({
        riseFall: v.string(), rateQuality: v.picklist(['fast and shallow', 'slow and deep']), ntucp: v.array(v.string()),
      }),
      history: v.strictObject({ asthmaCopd: v.string(), other: v.string() }),
      circulation: v.strictObject({ pulse: v.string() }),
      rbs: v.strictObject({
        findings: v.string(), jvd: v.boolean(), pedalEdema: v.boolean(), gloves: v.string(), pockets: v.array(v.string()),
        // limbInjury cases only; where is the limb step 12's immobilise say names ({limbWhere}: "right leg", Plan 3 D22)
        limb: v.optional(v.strictObject({
          injury: v.string(), where: v.pipe(v.string(), v.minLength(1, 'A limb injury names where it is.')), distalPulse: v.string(),
          immobilise: v.string(),
        })),
      }),
      investigation: v.strictObject({
        auscultation: v.string(),
        bp: v.string(),   // the reading only, e.g. '148/88 mmHg'; the arm is bpArm, the screening answer patient.lines.bpScreen
        bpArm: v.picklist(['left', 'right']),   // the arm the canonical line names
        // the patient's bpScreen rules the other arm out (a cut forearm, a dialysis fistula), so only bpArm is the BP arm;
        // where it is left out either arm is (final review I2)
        bpArmRestricted: v.optional(v.literal(true)),
        ecg: v.strictObject({ type: v.picklist(['12-lead', '4-lead']), reading: v.string() }),
        hypocount: v.number(),
      }),
      vitals: v.strictObject({ gcs: v.strictObject({ e: v.number(), v: v.number(), m: v.number() }), severity: v.string() }),
      // toward: where to move the patient when the choice is not ideal (notes s01 Position: sitting for breathless, supine
      // for low BP); the convince point reads that direction through the {posture} match slot
      position: v.strictObject({ choice: v.string(), ideal: v.boolean(), toward: v.optional(v.picklist(['sit-up', 'supine'])) }),
    }),
    vitals: v.strictObject({ roomAir: VitalsSchema, afterO2: VitalsSchema }),   // wrong mask or flow = roomAir values (spec §11)
    expected: v.strictObject({
      oxygen: v.strictObject({
        device: v.picklist(OXYGEN_DEVICES),
        flowMin: v.nullable(v.number()),
        flowMax: v.nullable(v.number()),
        optional: v.optional(v.literal(true)),
        note: v.optional(v.pipe(v.string(), v.minLength(1))),   // why this device, shown when the trainee picks another
      }),
      ecg: v.picklist(['12-lead', '4-lead']),
      decision: v.strictObject({
        stable: v.literal(false),   // every case is unstable (spec §6.3)
        signs: v.pipe(v.array(v.string()), v.minLength(2)),
        suspected: v.string(),
        plan: v.picklist(['stay-and-treat', 'load-and-go']),
      }),
    }),
  }),
  // a position that is not ideal names its direction, and an ideal one names none
  v.forward(
    v.check(c => (c.findings.position.toward !== undefined) === !c.findings.position.ideal,
      'A position names where to move the patient (toward) exactly when it is not ideal.'),
    ['findings', 'position'],
  ),
);
export type Case = v.InferOutput<typeof CaseSchema>;

export const CaseIndexSchema = v.strictObject({
  cases: v.array(v.strictObject({ id: v.string(), file: v.string(), type: CaseTypeSchema, complaint: v.string(), area: v.string() })),
});
export type CaseIndex = v.InferOutput<typeof CaseIndexSchema>;

/** Whether a must-hit `when` condition applies to a case. */
export function conditionHolds(c: Case, cond: Condition): boolean {
  switch (cond) {
    case 'medical':
    case 'trauma':
      return c.type === cond;
    case 'neckPain':
      return c.findings.spine.neckPain;
    case 'catastrophicBleeding':
      return c.findings.approach.catastrophicBleeding;
    case 'positionNotIdeal':
      return !c.findings.position.ideal;
    case 'stayAndTreat':
      return c.expected.decision.plan === 'stay-and-treat';
    case 'loadAndGo':
      return c.expected.decision.plan === 'load-and-go';
    case 'spinal':
      return c.flags.includes('spinal') || c.findings.spine.neckPain;
    case 'noSpinal':
      return !conditionHolds(c, 'spinal');
    default:
      return c.flags.includes(cond);
  }
}

/** Walks a dotted path from the case root, e.g. "findings.airway.mouth"; undefined when any key is absent. */
export function getFinding(c: Case, path: string): unknown {
  let cur: unknown = c;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
