// TEST-ONLY snippet, appended just before the final `return` of "Build Final Summary" in the test harness workflow.
// It adds machine-readable fields so the test scripts can verify results. The submitted workflow does not contain it.
Object.assign(json, {
  status: flagged ? 'routed_with_warnings' : 'routed',
  team: row.team,
  contact: row.on_call_contact,
  channel: row.escalation_channel,
  matched_incident_id: matched ? matched.incident_id : 'None',
  severity_hint: c.severity_hint,
  urgency: c.urgency,
  attempts_used: c.attempt + 1,
  tools_called: c.tools_called,
  history_tool_called: c.history_tool_called,
  redacted_error_summary: c.redacted_error_summary,
  redaction_count: c.redaction_count,
  warnings: notes,
  summary: Object.entries(json).map(([k, v]) => `${k}: ${v}`).join('\n'),
});
