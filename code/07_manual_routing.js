// Code node: "Manual Routing Message"  (mode: Run Once for All Items)
// Reached when the checks still fail after the maximum of 2 retries.

const c = $input.first().json;
const one = (v) => String(v ?? '').replace(/\s*\n+\s*/g, ' ').trim();
const failures = c.failures ?? [];

const json = {
  'Result': 'MANUAL ROUTING NEEDED',
  'What to do': 'Ask a team lead or the duty manager to route this incident. The assistant could not give a verified recommendation after 3 attempts (1 try + 2 retries).',
  'What was reported': one(c.redacted_error_summary),
  'Exact error': one(c.redacted_specific_error),
  'Seriousness': `${String(c.severity_hint).toUpperCase()}, ${c.urgency} (${c.users_affected} customers, ${c.minutes_since_start} min)`,
  'Why it stopped': failures.slice(0, 3).map(one).join(' | '),
};

return [{ json }];
