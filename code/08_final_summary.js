// Code node: "Build Final Summary"  (mode: Run Once for All Items)
// Outputs one short, single-line field per item so the Table view reads like a form.
// Contact details come from the Team Directory row, not from the model.

const c = $('Rule-Based Validation').first().json;
const o = c.agent_output;
const row = c.directory_row;
const matched = c.matched_incident_row;

// keep every value on a single line
const one = (v) => String(v ?? '').replace(/\s*\n+\s*/g, ' ').trim();

// LLM judge result (may be missing if the judge call failed or was rate-limited)
let judge = null;
try {
  const j = $input.first().json;
  // The LLM chain node may return the parsed object under output / text / response
  for (const candidate of [j.output, j.text, j.response, j]) {
    let v = candidate;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (e) { v = null; }
    }
    if (v && typeof v === 'object' && typeof v.action_fits_severity === 'boolean') {
      judge = v;
      break;
    }
  }
} catch (e) {
  judge = null;
}

// Notes appear only when there is something the front desk should know
const notes = [...c.rule_validation.notes];
const judgeConcern = !!judge && (judge.action_fits_severity === false || judge.tone_fits_urgency === false);
const flagged = c.rule_validation.notes.length > 0 || judgeConcern;
if (judgeConcern) notes.push(`Second-opinion review: ${judge.explanation}`);
if (!judge) notes.push('Second-opinion review was not available (rule checks only).');
if (c.attempt > 0) notes.push(`The assistant needed ${c.attempt} retr${c.attempt === 1 ? 'y' : 'ies'} to pass the automatic checks.`);
if (c.redaction_count > 0) notes.push(`${c.redaction_count} sensitive item(s) were masked before analysis (${c.redaction_types.join(', ')}).`);

const pastIncident = matched
  ? `${matched.incident_id}, resolved by ${matched.resolving_team} (cause: ${matched.root_cause}; fix: ${matched.resolution})`
  : 'No similar past incident was found in the incident history.';

const json = {
  'Send this to': row.team,
  'Contact': `${row.on_call_contact} (${row.escalation_channel})`,
  'Do this first': one(o.first_action),
  'Past incident': one(pastIncident),
  'Tell customers': one(o.customer_message),
  'Why': one(o.reasoning),
  'Seriousness': `${String(c.severity_hint).toUpperCase()}, ${c.urgency} (${c.users_affected} customers, ${c.minutes_since_start} min)`,
  'Notes': notes.length ? notes.map(one).join(' | ') : 'None',
};

return [{ json }];
