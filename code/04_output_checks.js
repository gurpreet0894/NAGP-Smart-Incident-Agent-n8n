// Code node: "Output Checks"  (mode: Run Once for All Items)
// Guardrail applied after every agent attempt. Checks against the REAL sheet data
// (loaded by the "Load Team Directory" / "Load Incident History" nodes), not the agent's memory.
//
//  1. primary_team is an exact team name from the Team Directory
//     (and contact / channel returned by the agent match that directory row)
//  2. severity is not downplayed: high severity needs an escalating action, never "just monitor"
//  3. matched_incident_id is "None" or a real ID from the Incident History
//     (and the resolving team quoted matches the sheet; the history tool must actually have been called)
//
// $runIndex = 0 for the first attempt, 1 for retry #1, 2 for retry #2.

const base = $('Prepare Agent Input').first().json;
const raw = $input.first().json;
const attempt = $runIndex;

const teams = $('Load Team Directory').all().map((i) => i.json);
const history = $('Load Incident History').all().map((i) => i.json);

const failures = [];
const out = raw.output && typeof raw.output === 'object' ? raw.output : null;

if (!out) {
  failures.push(
    `The agent did not return a valid structured answer${raw.error ? ` (${String(raw.error).slice(0, 200)})` : ''}.`
  );
}

const norm = (s) => String(s ?? '').trim();
const teamRow = out ? teams.find((t) => norm(t.team) === norm(out.primary_team)) : null;

if (out) {
  // ---- Check 1: exact team name ----
  if (!teamRow) {
    failures.push(
      `primary_team "${norm(out.primary_team)}" is not an exact team name in the Team Directory. ` +
        `Valid names: ${teams.map((t) => `"${t.team}"`).join(', ')}.`
    );
  } else {
    if (norm(out.on_call_contact) !== norm(teamRow.on_call_contact)) {
      failures.push(
        `on_call_contact "${norm(out.on_call_contact)}" does not match the Team Directory value "${teamRow.on_call_contact}" for ${teamRow.team}.`
      );
    }
    if (norm(out.escalation_channel) !== norm(teamRow.escalation_channel)) {
      failures.push(
        `escalation_channel "${norm(out.escalation_channel)}" does not match the Team Directory value "${teamRow.escalation_channel}" for ${teamRow.team}.`
      );
    }
  }

  // ---- Check 2: severity not downplayed ----
  if (base.severity_hint === 'high') {
    const action = norm(out.first_action);
    const downplay =
      /\b(just|simply|only)\s+(monitor|watch|wait)|wait and see|keep an eye|no action|do nothing|hold off|\bmonitor(ing)?\b\s*(it|this|the situation)?\s*\.?$/i;
    // "page" only counts when it is the verb ("page the on-call engineer"), not the noun ("product page")
    const escalates = /\b(page\s+(the\s+)?(on-?call|engineer|team)|escalat|contact|call|notify|alert|post|message|raise|ping|open an? (incident|ticket))\w*/i;
    if (downplay.test(action) || !escalates.test(action)) {
      failures.push(
        `severity_hint is HIGH but first_action ("${action}") is passive. Give an escalating first action ` +
          `(for example contact the on-call person or post in the escalation channel now). Do not recommend only monitoring.`
      );
    }
  }

  // ---- Check 3: matched incident ID is None or real ----
  const id = norm(out.matched_incident_id);
  if (id.toLowerCase() !== 'none') {
    const row = history.find((h) => norm(h.incident_id) === id);
    if (!row) {
      failures.push(
        `matched_incident_id "${id}" does not exist in the Incident History. Use "None" if nothing matches. ` +
          `Real IDs: ${history.map((h) => h.incident_id).join(', ')}.`
      );
    } else if (norm(out.matched_incident_resolving_team) !== norm(row.resolving_team)) {
      failures.push(
        `matched_incident_resolving_team "${norm(out.matched_incident_resolving_team)}" does not match the history for ${id} (it was resolved by "${row.resolving_team}").`
      );
    }
  }
}

// Evidence of which tools the agent really called
const steps = Array.isArray(raw.intermediateSteps) ? raw.intermediateSteps : [];
const toolsCalled = steps.map((s) => String(s?.action?.tool ?? '')).filter(Boolean);
const calledHistory = toolsCalled.some((t) => /incident_history/i.test(t));
const calledDirectory = toolsCalled.some((t) => /team_directory/i.test(t));

if (out && norm(out.matched_incident_id).toLowerCase() !== 'none' && !calledHistory) {
  failures.push('You cited a past incident but never called the incident_history tool. Call it before citing an incident.');
}
if (out && !calledDirectory) {
  failures.push('You did not call the team_directory tool. Team and contact details must come from that tool.');
}

const matchedRow =
  out && norm(out.matched_incident_id).toLowerCase() !== 'none'
    ? history.find((h) => norm(h.incident_id) === norm(out.matched_incident_id)) ?? null
    : null;

return [
  {
    json: {
      ...base,
      agent_output: out,
      tools_called: toolsCalled,
      history_tool_called: calledHistory,
      directory_tool_called: calledDirectory,
      // Authoritative values taken from the sheet, never from the model
      directory_row: teamRow ?? null,
      matched_incident_row: matchedRow,
      checks_passed: failures.length === 0,
      failures,
      attempt,
      max_retries: 2,
    },
  },
];
