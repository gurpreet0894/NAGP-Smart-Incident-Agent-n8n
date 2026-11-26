// TEST-ONLY Code node: "Test Failure Injection"  (exists only in the TEST-webhook build, never in the submitted workflow)
// Sits between the agent and "Output Checks". When the webhook body contains `test_mode`, it corrupts the agent's
// answer for the first `fail_attempts` attempts so the guardrail (checks -> retry with reasons -> manual routing)
// can be demonstrated live on demand. Without `test_mode` it passes the answer through untouched.
//
//   test_mode      what it corrupts                                           which check should react
//   bad_team       primary_team -> "Payments" (not an exact directory name)   check 1
//   fake_incident  matched_incident_id -> "INC-999" (not in the history)      check 3
//   passive_action first_action -> "Just monitor the situation."              check 2 (only when severity is high)
//   bad_tone       tone -> "calm_informational" (every attempt)               decision validation (a warning, not a retry)
//   fail_attempts  how many attempts to corrupt: 1 (default), 2, or 99 = always
//
// $runIndex = 0 on the first attempt, 1 on retry 1, 2 on retry 2.

const raw = $input.first().json;

let body = {};
try {
  body = $('Test Webhook').first().json.body ?? {};
} catch (e) {
  body = {};
}

const mode = String(body.test_mode ?? '').trim();
const failAttempts = Number.isFinite(Number(body.fail_attempts)) ? Number(body.fail_attempts) : 1;
const attempt = $runIndex;

if (!mode || !raw.output || typeof raw.output !== 'object') {
  return [{ json: raw }];
}

const out = { ...raw.output };
const corrupt = attempt < failAttempts;

if (mode === 'bad_team' && corrupt) out.primary_team = 'Payments';
if (mode === 'fake_incident' && corrupt) out.matched_incident_id = 'INC-999';
if (mode === 'passive_action' && corrupt) out.first_action = 'Just monitor the situation.';
if (mode === 'bad_tone') out.tone = 'calm_informational';

return [{ json: { ...raw, output: out } }];
