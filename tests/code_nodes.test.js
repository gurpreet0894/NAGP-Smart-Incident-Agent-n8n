const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runCode } = require('./harness');

// ---- shared fixtures: the real CSV data is used so the tests match the sheet ----
function parseCsv(file) {
  const text = fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8').trim();
  const rows = [];
  let cur = [''], q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
      else if (ch === '"') q = false;
      else cur[cur.length - 1] += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') cur.push('');
    else if (ch === '\n') { rows.push(cur); cur = ['']; }
    else if (ch !== '\r') cur[cur.length - 1] += ch;
  }
  rows.push(cur);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const TEAMS = parseCsv('team_directory.csv');
const HISTORY = parseCsv('incident_history.csv');

const redact = (o) => runCode('01_redact.js', o)[0];
const enrich = (o) => runCode('02_enrich.js', { redacted_error_summary: '', redacted_specific_error: '', ...o })[0];

// ================= Redaction =================
test('redacts email addresses', () => {
  const r = redact({ error_summary: 'Customer jane.doe@gmail.com cannot pay', specific_error: '', users_affected: 1, minutes_since_start: 1 });
  assert.equal(r.redacted_error_summary, 'Customer [EMAIL] cannot pay');
});

test('redacts phone numbers in several formats', () => {
  for (const p of ['+91 98765 43210', '(415) 555-2671', '9876543210', '+44 20 7946 0958']) {
    const r = redact({ error_summary: `call me on ${p} please`, specific_error: '', users_affected: 1, minutes_since_start: 1 });
    assert.match(r.redacted_error_summary, /\[PHONE\]/, p);
    assert.doesNotMatch(r.redacted_error_summary, /\d{4}/, p);
  }
});

test('redacts card numbers (spaced, dashed, plain)', () => {
  for (const c of ['4111 1111 1111 1111', '4111-1111-1111-1111', '4111111111111111']) {
    const r = redact({ error_summary: `card ${c} was declined`, specific_error: '', users_affected: 1, minutes_since_start: 1 });
    assert.equal(r.redacted_error_summary, 'card [CARD/NUMBER] was declined', c);
  }
});

test('redacts token-like strings and keys', () => {
  const samples = [
    'AKIAIOSFODNN7EXAMPLE',
    'sk-proj-abc123def456ghi789jkl',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'Bearer abcdef1234567890abcdef',
    'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw',
    'a8f3k2j9d0s7g6h5j4k3l2m1',
  ];
  for (const s of samples) {
    const r = redact({ error_summary: `my key is ${s} thanks`, specific_error: '', users_affected: 1, minutes_since_start: 1 });
    assert.match(r.redacted_error_summary, /\[SECRET\]/, s);
    assert.doesNotMatch(r.redacted_error_summary, /AKIA|sk-proj|ghp_|abcdef12|eyJ|a8f3k2/, s);
  }
});

test('redacts the specific_error field too and leaves normal text alone', () => {
  const r = redact({
    error_summary: 'About 500 customers see an error after 20 minutes at checkout (INC-101 style)',
    specific_error: 'Error for user a@b.co token 9f8e7d6c5b4a39281716',
    users_affected: 500,
    minutes_since_start: 20,
  });
  assert.equal(r.redacted_error_summary, 'About 500 customers see an error after 20 minutes at checkout (INC-101 style)');
  assert.equal(r.redacted_specific_error, 'Error for user [EMAIL] token [SECRET]');
  assert.equal(r.redaction_count, 2);
});

test('empty specific_error becomes "None reported" and bad numbers become 0', () => {
  const r = redact({ error_summary: 'x', specific_error: '', users_affected: 'about 120', minutes_since_start: 'abc' });
  assert.equal(r.redacted_specific_error, 'None reported');
  assert.equal(r.users_affected, 120);
  assert.equal(r.minutes_since_start, 0);
});

// ================= Enrichment =================
test('severity thresholds on customers affected', () => {
  assert.equal(enrich({ users_affected: 10, minutes_since_start: 5 }).severity_hint, 'low');
  assert.equal(enrich({ users_affected: 49, minutes_since_start: 5 }).severity_hint, 'low');
  assert.equal(enrich({ users_affected: 50, minutes_since_start: 5 }).severity_hint, 'medium');
  assert.equal(enrich({ users_affected: 499, minutes_since_start: 5 }).severity_hint, 'medium');
  assert.equal(enrich({ users_affected: 500, minutes_since_start: 5 }).severity_hint, 'high');
});

test('payment wording raises severity one level, capped at high', () => {
  assert.equal(enrich({ redacted_error_summary: 'customers charged twice', users_affected: 10, minutes_since_start: 5 }).severity_hint, 'medium');
  assert.equal(enrich({ redacted_error_summary: 'checkout broken', users_affected: 100, minutes_since_start: 5 }).severity_hint, 'high');
  assert.equal(enrich({ redacted_error_summary: 'checkout broken', users_affected: 9000, minutes_since_start: 5 }).severity_hint, 'high');
});

test('"two charges" / "charged twice" count as payment wording', () => {
  for (const txt of ['bank shows two charges for one order', 'customers charged twice', 'double charge on the card']) {
    assert.equal(enrich({ redacted_error_summary: txt, users_affected: 40, minutes_since_start: 5 }).severity_hint, 'medium', txt);
  }
});

test('urgency thresholds on minutes since start', () => {
  const u = (m) => enrich({ users_affected: 1, minutes_since_start: m }).urgency;
  assert.equal(u(0), 'new');
  assert.equal(u(14), 'new');
  assert.equal(u(15), 'ongoing');
  assert.equal(u(60), 'ongoing');
  assert.equal(u(61), 'prolonged');
});

// ================= Output checks =================
const base = {
  redacted_error_summary: 'Checkout failing', redacted_specific_error: 'Something went wrong',
  users_affected: 600, minutes_since_start: 20, severity_hint: 'high', urgency: 'ongoing',
  retry_count: 0, retry_feedback: '',
};
const goodOutput = {
  primary_team: 'Payments Backend',
  on_call_contact: 'payments-oncall@shopnow.example',
  escalation_channel: '#payments-oncall',
  matched_incident_id: 'INC-101',
  matched_incident_resolving_team: 'Payments Backend',
  first_action: 'Contact payments-oncall@shopnow.example now and post in #payments-oncall.',
  tone: 'reassuring_proactive',
  customer_message: 'We are aware and the team is working on it.',
  reasoning: 'x',
};
const steps = [
  { action: { tool: 'team_directory' } },
  { action: { tool: 'incident_history' } },
];
function checks(output, { intermediateSteps = steps, runIndex = 0, error } = {}) {
  return runCode(
    '04_output_checks.js',
    { output, intermediateSteps, error },
    { 'Prepare Agent Input': [base], 'Load Team Directory': TEAMS, 'Load Incident History': HISTORY },
    runIndex
  )[0];
}

test('a correct answer passes all checks', () => {
  const r = checks(goodOutput);
  assert.equal(r.checks_passed, true, r.failures.join(' | '));
  assert.equal(r.matched_incident_row.incident_id, 'INC-101');
});

test('check 1: unknown or inexact team name fails', () => {
  for (const team of ['Payments', 'payments backend', 'Billing Team']) {
    const r = checks({ ...goodOutput, primary_team: team });
    assert.equal(r.checks_passed, false, team);
    assert.match(r.failures[0], /exact team name/);
  }
});

test('check 1b: contact details that do not match the sheet fail', () => {
  const r = checks({ ...goodOutput, on_call_contact: 'made.up@shopnow.example' });
  assert.equal(r.checks_passed, false);
  assert.match(r.failures.join(' '), /on_call_contact/);
});

test('check 2: "just monitor" is rejected for high severity', () => {
  for (const a of ['Just monitor the situation.', 'Keep an eye on it.', 'Monitor.', 'Wait and see if it gets worse.']) {
    const r = checks({ ...goodOutput, first_action: a });
    assert.equal(r.checks_passed, false, a);
    assert.match(r.failures.join(' '), /passive/);
  }
});

test('check 2: not applied when severity is not high', () => {
  const r = runCode(
    '04_output_checks.js',
    { output: { ...goodOutput, first_action: 'Monitor and log a ticket.' }, intermediateSteps: steps },
    { 'Prepare Agent Input': [{ ...base, severity_hint: 'low' }], 'Load Team Directory': TEAMS, 'Load Incident History': HISTORY }
  )[0];
  assert.equal(r.checks_passed, true);
});

test('check 3: invented incident ID fails; "None" passes', () => {
  const bad = checks({ ...goodOutput, matched_incident_id: 'INC-999' });
  assert.equal(bad.checks_passed, false);
  assert.match(bad.failures.join(' '), /does not exist/);
  const none = checks({ ...goodOutput, matched_incident_id: 'None', matched_incident_resolving_team: 'None' });
  assert.equal(none.checks_passed, true, none.failures.join(' | '));
});

test('check 3b: wrong resolving team for a real incident fails', () => {
  const r = checks({ ...goodOutput, matched_incident_resolving_team: 'Catalog & Search' });
  assert.equal(r.checks_passed, false);
});

test('citing an incident without calling the history tool fails', () => {
  const r = checks(goodOutput, { intermediateSteps: [{ action: { tool: 'team_directory' } }] });
  assert.equal(r.checks_passed, false);
  assert.match(r.failures.join(' '), /never called the incident_history/);
});

test('skipping the history tool is fine when no incident is cited', () => {
  const r = checks(
    { ...goodOutput, matched_incident_id: 'None', matched_incident_resolving_team: 'None' },
    { intermediateSteps: [{ action: { tool: 'team_directory' } }] }
  );
  assert.equal(r.checks_passed, true, r.failures.join(' | '));
  assert.equal(r.history_tool_called, false);
});

test('missing structured output (agent error) fails and reports the attempt number', () => {
  const r = checks(undefined, { error: 'parse failure', runIndex: 2 });
  assert.equal(r.checks_passed, false);
  assert.equal(r.attempt, 2);
});

// ================= Retry input =================
test('retry builder increments the counter and includes every failure reason', () => {
  const failed = checks({ ...goodOutput, primary_team: 'Billing Team', matched_incident_id: 'INC-999' });
  const r = runCode('05_build_retry.js', failed)[0];
  assert.equal(r.retry_count, 1);
  assert.match(r.retry_feedback, /Billing Team/);
  assert.match(r.retry_feedback, /INC-999/);
  assert.equal(r.agent_output, undefined);
  assert.equal(r.severity_hint, 'high');
});

// ================= Rule validation + final summary =================
function passed(output, over = {}) {
  const c = checks(output);
  return { ...c, ...over };
}

test('rule validation flags a tone that does not fit prolonged urgency', () => {
  const c = passed({ ...goodOutput, tone: 'calm_informational' }, { urgency: 'prolonged' });
  const r = runCode('06_rule_validation.js', c)[0];
  assert.equal(r.rule_validation.tone_fits_urgency, false);
  assert.equal(r.rule_validation.action_fits_severity, true);
});

test('the noun "page" (product page) is not treated as paging the on-call engineer', () => {
  const c = passed(
    { ...goodOutput, first_action: 'Send a message to #catalog-search about the typo so the team can update the product page text.' },
    { severity_hint: 'low' }
  );
  const r = runCode('06_rule_validation.js', c)[0];
  assert.equal(r.rule_validation.action_fits_severity, true, r.rule_validation.notes.join(' '));
});

test('check 2: "page" as a noun does not count as an escalation for high severity', () => {
  const r = checks({ ...goodOutput, first_action: 'Keep the product page open and see what happens.' });
  assert.equal(r.checks_passed, false);
  assert.match(r.failures.join(' '), /passive/);
  const ok = checks({ ...goodOutput, first_action: 'Page the on-call engineer now and post in #payments-oncall.' });
  assert.equal(ok.checks_passed, true, ok.failures.join(' | '));
});

test('rule validation flags an emergency reaction for low severity', () => {
  const c = passed({ ...goodOutput, first_action: 'Page the on-call engineer immediately.' }, { severity_hint: 'low' });
  const r = runCode('06_rule_validation.js', c)[0];
  assert.equal(r.rule_validation.action_fits_severity, false);
});

const runFinal = (judgeJson, validated, diagnostics = false) => {
  const { runCode: _r } = require('./harness');
  const fs2 = require('fs');
  let src = fs2.readFileSync(path.join(__dirname, '..', 'code', '08_final_summary.js'), 'utf8');
  if (diagnostics) {
    // the test harness appends this snippet before the final return; the submitted node does not contain it
    const snippet = fs2.readFileSync(path.join(__dirname, '..', 'code', 'test_only', 'diagnostics_final.js'), 'utf8');
    const i = src.lastIndexOf('return [{ json }];');
    src = src.slice(0, i) + snippet + '\n' + src.slice(i);
  }
  const $input = { first: () => ({ json: judgeJson }) };
  const $ = () => ({ first: () => ({ json: validated }) });
  return new Function('$input', '$', '$runIndex', src)($input, $, 0)[0].json;
};

test('final output is labelled single-line fields (no raw JSON text, no line breaks) with sheet-based contact and cited incident', () => {
  const c = passed(goodOutput, { redaction_count: 1, redaction_types: ['EMAIL x1'] });
  const v = runCode('06_rule_validation.js', c)[0];
  const f = runFinal({ output: { action_fits_severity: true, tone_fits_urgency: true, explanation: 'Looks right.' } }, v);
  assert.deepEqual(Object.keys(f), ['Send this to', 'Contact', 'Do this first', 'Past incident', 'Tell customers', 'Why', 'Seriousness', 'Notes']);
  assert.equal(f['Send this to'], 'Payments Backend');
  assert.equal(f['Contact'], 'payments-oncall@shopnow.example (#payments-oncall)');
  assert.match(f['Past incident'], /^INC-101, resolved by Payments Backend/);
  assert.match(f['Notes'], /1 sensitive item/);
  assert.equal(f['Seriousness'], 'HIGH, ongoing (600 customers, 20 min)');
  for (const v of Object.values(f)) assert.doesNotMatch(String(v), /[\r\n]/); // no line breaks, so nothing shows as \n
  assert.doesNotMatch(f['Notes'], /Second-opinion/); // nothing to flag when the judge is happy
});

test('a multi-line value from the model is flattened onto one line', () => {
  const c = passed({ ...goodOutput, first_action: 'Contact the on-call person now.\n\nPost in the channel.' });
  const v = runCode('06_rule_validation.js', c)[0];
  const f = runFinal({ output: { action_fits_severity: true, tone_fits_urgency: true, explanation: 'ok' } }, v);
  assert.equal(f['Do this first'], 'Contact the on-call person now. Post in the channel.');
});

test('diagnostics are only present in the test build', () => {
  const c = passed(goodOutput);
  const v = runCode('06_rule_validation.js', c)[0];
  const j = { output: { action_fits_severity: true, tone_fits_urgency: true, explanation: 'ok' } };
  const d = runFinal(j, v, true);
  assert.equal(d.team, 'Payments Backend');
  assert.equal(d.matched_incident_id, 'INC-101');
  assert.equal(d.status, 'routed');
  assert.match(d.summary, /Send this to: Payments Backend/);
  assert.deepEqual(d.tools_called, ['team_directory', 'incident_history']);
});

test('a judge concern appears once under NOTES and flags the status', () => {
  const c = passed(goodOutput);
  const v = runCode('06_rule_validation.js', c)[0];
  const j = { output: { action_fits_severity: true, tone_fits_urgency: false, explanation: 'Tone is too casual.' } };
  const f = runFinal(j, v);
  assert.equal(f['Notes'].split('Tone is too casual.').length - 1, 1);
  assert.equal(runFinal(j, v, true).status, 'routed_with_warnings');
});

test('final summary says clearly when there is no past incident and survives a missing judge', () => {
  const c = passed({ ...goodOutput, matched_incident_id: 'None', matched_incident_resolving_team: 'None' });
  const v = runCode('06_rule_validation.js', c)[0];
  const f = runFinal({ error: 'rate limited' }, v);
  assert.match(f['Past incident'], /No similar past incident was found/);
  assert.match(f['Notes'], /not available/);
});

test('manual routing message is labelled fields listing the reasons', () => {
  const failed = checks({ ...goodOutput, primary_team: 'Billing Team' }, { runIndex: 2 });
  const r = runCode('07_manual_routing.js', failed)[0];
  assert.deepEqual(Object.keys(r), ['Result', 'What to do', 'What was reported', 'Exact error', 'Seriousness', 'Why it stopped']);
  assert.equal(r['Result'], 'MANUAL ROUTING NEEDED');
  assert.match(r['Why it stopped'], /Billing Team/);
  assert.match(r['What to do'], /3 attempts/);
});

// ================= Test-only failure injection + simulated guardrail loop =================
function inject(mode, failAttempts, runIndex, out = goodOutput) {
  const body = mode ? { test_mode: mode, fail_attempts: failAttempts } : {};
  return runCode(
    'test_only/failure_injection.js',
    { output: out, intermediateSteps: steps },
    { 'Test Webhook': [{ body }] },
    runIndex
  )[0];
}

test('failure injection is a no-op without test_mode', () => {
  assert.deepEqual(inject(undefined, 1, 0).output, goodOutput);
});

test('failure injection corrupts only the first N attempts', () => {
  assert.equal(inject('bad_team', 1, 0).output.primary_team, 'Payments');
  assert.equal(inject('bad_team', 1, 1).output.primary_team, 'Payments Backend');
  assert.equal(inject('bad_team', 2, 1).output.primary_team, 'Payments');
  assert.equal(inject('bad_team', 2, 2).output.primary_team, 'Payments Backend');
  assert.equal(inject('bad_team', 99, 2).output.primary_team, 'Payments');
  assert.equal(inject('fake_incident', 1, 0).output.matched_incident_id, 'INC-999');
  assert.equal(inject('passive_action', 1, 0).output.first_action, 'Just monitor the situation.');
  assert.equal(inject('bad_tone', 1, 2).output.tone, 'calm_informational'); // tone is corrupted on every attempt
});

// Replays what n8n does: agent -> injection -> Output Checks -> (pass | retries left? -> retry -> agent | manual routing)
function simulateLoop(mode, failAttempts) {
  let state = base;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const injected = inject(mode, failAttempts, attempt, state.retry_feedback ? goodOutput : goodOutput);
    const c = runCode(
      '04_output_checks.js',
      injected,
      { 'Prepare Agent Input': [base], 'Load Team Directory': TEAMS, 'Load Incident History': HISTORY },
      attempt
    )[0];
    if (c.checks_passed) return { outcome: 'routed', attempts: attempt + 1, last: c };
    if (!(c.attempt < c.max_retries)) {
      return { outcome: 'manual', attempts: attempt + 1, last: c, manual: runCode('07_manual_routing.js', c)[0] };
    }
    state = runCode('05_build_retry.js', c)[0]; // feedback that would be sent back to the agent
    assert.match(state.retry_feedback, new RegExp(`RETRY ${attempt + 1} of 2`));
  }
}

test('guardrail loop: bad answer on the first attempt only recovers on retry 1', () => {
  const r = simulateLoop('bad_team', 1);
  assert.equal(r.outcome, 'routed');
  assert.equal(r.attempts, 2);
});

test('guardrail loop: bad answer twice recovers on retry 2 (the last allowed attempt)', () => {
  const r = simulateLoop('fake_incident', 2);
  assert.equal(r.outcome, 'routed');
  assert.equal(r.attempts, 3);
});

test('guardrail loop: permanent bad answer ends in manual routing after exactly 3 attempts', () => {
  const r = simulateLoop('bad_team', 99);
  assert.equal(r.outcome, 'manual');
  assert.equal(r.attempts, 3);
  assert.equal(r.manual['Result'], 'MANUAL ROUTING NEEDED');
  assert.match(r.manual['Why it stopped'], /exact team name/);
});

test('guardrail loop: passive action on a high-severity incident is rejected then recovers', () => {
  const r = simulateLoop('passive_action', 1);
  assert.equal(r.outcome, 'routed');
  assert.equal(r.attempts, 2);
});
