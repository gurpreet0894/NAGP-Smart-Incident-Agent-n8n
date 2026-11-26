// Code node: "Rule-Based Validation"  (mode: Run Once for All Items)
// Decision validation, part 1 (deterministic). Part 2 is the LLM judge.
//  - Does the first action fit the severity?
//  - Does the communication tone fit the urgency?

const c = $input.first().json;
const o = c.agent_output;
const action = String(o.first_action ?? '');
const tone = String(o.tone ?? '').trim();
const notes = [];

// ---- Action vs severity ----
// "page" only counts as an escalation when it is the verb ("page the on-call engineer"), not the noun ("product page")
const escalates = /\b(page\s+(the\s+)?(on-?call|engineer|team)|escalat|contact|call|notify|alert|post|message|raise|ping|open an? (incident|ticket))\w*/i;
const overReaction = /\bpage\s+(the\s+)?(on-?call|engineer|team)|\b(emergency|immediately|urgent(ly)?|right now|all hands)\b/i;
const passive = /\b(just|simply|only)\s+(monitor|watch|wait)|wait and see|keep an eye|no action|do nothing/i;

let action_fits_severity = true;
if (c.severity_hint === 'high' && (passive.test(action) || !escalates.test(action))) {
  action_fits_severity = false;
  notes.push('High severity but the first action is not an escalation.');
} else if (c.severity_hint === 'medium' && passive.test(action)) {
  action_fits_severity = false;
  notes.push('Medium severity but the first action is only passive monitoring.');
} else if (c.severity_hint === 'low' && overReaction.test(action)) {
  action_fits_severity = false;
  notes.push('Low severity but the first action sounds like an emergency escalation.');
}

// ---- Tone vs urgency ----
const allowed = {
  new: ['calm_informational', 'reassuring_proactive'],
  ongoing: ['reassuring_proactive', 'apologetic_urgent'],
  prolonged: ['apologetic_urgent'],
};
const tone_fits_urgency = (allowed[c.urgency] ?? []).includes(tone);
if (!tone_fits_urgency) {
  notes.push(`Urgency is "${c.urgency}" but tone is "${tone}" (expected one of: ${(allowed[c.urgency] ?? []).join(', ')}).`);
}

return [{ json: { ...c, rule_validation: { action_fits_severity, tone_fits_urgency, notes } } }];
