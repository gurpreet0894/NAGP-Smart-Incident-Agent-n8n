// TEST-ONLY snippet, appended just before the final `return` of "Manual Routing Message" in the test harness workflow.
// It adds machine-readable fields so the test scripts can verify results. The submitted workflow does not contain it.
Object.assign(json, {
  status: 'manual_routing_required',
  severity_hint: c.severity_hint,
  urgency: c.urgency,
  tools_called: c.tools_called,
  redacted_error_summary: c.redacted_error_summary,
  failures,
  attempts: (c.attempt ?? 0) + 1,
  summary: Object.entries(json).map(([k, v]) => `${k}: ${v}`).join('\n'),
});
