// Runs tests/live_cases.json against the TEST webhook workflow and writes tests/live_results.json + .md
// Usage:  node tests/run_live_cases.js <production-webhook-url> [gapSeconds=45] [onlyIds e.g. 1,3]
// Only fictional test data is sent. The webhook is the workflow you imported and activated yourself.
const fs = require('fs');
const path = require('path');

const [url, gapArg, onlyArg] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node tests/run_live_cases.js <webhook-url> [gapSeconds] [ids]');
  process.exit(1);
}
const gap = Number(gapArg ?? 45) * 1000;
const only = onlyArg ? onlyArg.split(',').map(Number) : null;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'live_cases.json'), 'utf8')).filter(
  (c) => !only || only.includes(c.id)
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function judge(c, r) {
  const e = c.expect;
  const problems = [];
  if (r.status === 'manual_routing_required') problems.push('workflow ended in manual routing');
  if (r.severity_hint !== e.severity_hint) problems.push(`severity ${r.severity_hint} != ${e.severity_hint}`);
  if (r.urgency !== e.urgency) problems.push(`urgency ${r.urgency} != ${e.urgency}`);
  if (r.team !== e.team) problems.push(`team ${r.team} != ${e.team}`);
  if (e.incident !== 'either' && r.matched_incident_id !== e.incident) problems.push(`incident ${r.matched_incident_id} != ${e.incident}`);
  const hist = !!r.history_tool_called;
  if (e.history === 'called' && !hist) problems.push('history tool was not called');
  if (e.history === 'not_needed' && hist) problems.push('history tool was called for an issue that clearly cannot match a past incident');
  if (e.redacted && r.status !== 'manual_routing_required' && !(r.redaction_count > 0)) problems.push('nothing was redacted');
  if (r.status !== 'manual_routing_required' && /@evil|Billing Team/.test(r.summary ?? '') && e.team !== 'Billing Team') problems.push('injected text leaked into the answer');
  return problems;
}

const RATE = /too many requests|rate limit|quota|429|overloaded|524|fetch failed/i;
async function callOnce(c) {
  let r, err;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c.input) });
    const text = await res.text();
    const brief = () => `HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`;
    try { r = JSON.parse(text); } catch { err = brief(); }
    if (!err && !res.ok) err = brief();
  } catch (e) {
    err = String(e);
  }
  return { r, err };
}
// A rate-limited run (provider quota, gateway timeout) says nothing about the logic, so wait and retry it.
const limited = ({ r, err }) => (err && RATE.test(err)) || (r && r.status === 'manual_routing_required' && RATE.test(JSON.stringify(r.failures ?? '')));

(async () => {
  const results = [];
  for (const [i, c] of cases.entries()) {
    const started = Date.now();
    let out = await callOnce(c);
    let tries = 1;
    while (limited(out) && tries < 4) {
      console.log(`#${c.id} rate limited, waiting 150s then retrying (try ${tries + 1})`);
      await sleep(150000);
      out = await callOnce(c);
      tries++;
    }
    const { r, err } = out;
    const problems = err ? [err] : judge(c, r);
    results.push({ case: c, tries, seconds: Math.round((Date.now() - started) / 1000), response: r ?? null, problems, pass: problems.length === 0 });
    console.log(`#${c.id} ${c.name}: ${problems.length ? 'FAIL - ' + problems.join('; ') : 'PASS'}  (${results.at(-1).seconds}s)`);
    if (i < cases.length - 1) await sleep(gap);
  }
  fs.writeFileSync(path.join(__dirname, 'live_results.json'), JSON.stringify(results, null, 2));
  const md = [
    '| # | Scenario | Severity / urgency | Team | Incident | Tools called | Attempts | Result |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map(({ case: c, response: r, problems, pass }) =>
      r
        ? `| ${c.id} | ${c.name} | ${r.severity_hint} / ${r.urgency} | ${r.team ?? '-'} | ${r.matched_incident_id ?? '-'} | ${(r.tools_called ?? []).join(', ') || '-'} | ${r.attempts_used ?? r.attempts ?? '-'} | ${pass ? 'PASS' : 'FAIL: ' + problems.join('; ')} |`
        : `| ${c.id} | ${c.name} | - | - | - | - | - | FAIL: ${problems.join('; ')} |`
    ),
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'live_results.md'), md + '\n');
  console.log(`\n${results.filter((x) => x.pass).length}/${results.length} passed. Wrote tests/live_results.json and live_results.md`);
})();
