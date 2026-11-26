// Runs the guardrail demonstrations (tests/guardrail_cases.json) against the TEST-webhook workflow, which contains the
// test-only "Test Failure Injection" node. Writes guardrail_results.json / guardrail_results.md next to this script.
// Usage:  node tests/run_guardrail_cases.js <production-webhook-url> [gapSeconds=5] [ids e.g. G1,G3]
const fs = require('fs');
const path = require('path');

const [url, gapArg, onlyArg] = process.argv.slice(2);
if (!url) { console.error('Usage: node tests/run_guardrail_cases.js <webhook-url> [gapSeconds] [ids]'); process.exit(1); }
const gap = Number(gapArg ?? 5) * 1000;
const only = onlyArg ? onlyArg.split(',') : null;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'guardrail_cases.json'), 'utf8')).filter((c) => !only || only.includes(c.id));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function judge(c, r) {
  const e = c.expect, p = [];
  if (r.status !== e.status) p.push(`status ${r.status} != ${e.status}`);
  const attempts = r.attempts_used ?? r.attempts;
  if (attempts !== e.attempts) p.push(`attempts ${attempts} != ${e.attempts}`);
  if (e.team && r.team !== e.team) p.push(`team ${r.team} != ${e.team}`);
  if (e.notesInclude && !String(r.Notes ?? '').includes(e.notesInclude)) p.push(`Notes lack "${e.notesInclude}"`);
  if (e.failuresInclude && !JSON.stringify(r.failures ?? '').includes(e.failuresInclude)) p.push(`failures lack "${e.failuresInclude}"`);
  if (e.status === 'manual_routing_required' && r['Result'] !== 'MANUAL ROUTING NEEDED') p.push('manual message missing');
  return p;
}

(async () => {
  const results = [];
  for (const [i, c] of cases.entries()) {
    const started = Date.now();
    let r, err;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c.input) });
      const text = await res.text();
      try { r = JSON.parse(text); } catch { err = `HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`; }
      if (!err && !res.ok) err = `HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`;
    } catch (e) { err = String(e); }
    const problems = err ? [err] : judge(c, r);
    results.push({ case: c, seconds: Math.round((Date.now() - started) / 1000), response: r ?? null, problems, pass: problems.length === 0 });
    console.log(`${c.id} ${c.name}: ${problems.length ? 'FAIL - ' + problems.join('; ') : 'PASS'} (${results.at(-1).seconds}s)`);
    if (i < cases.length - 1) await sleep(gap);
  }
  fs.writeFileSync(path.join(__dirname, 'guardrail_results.json'), JSON.stringify(results, null, 2));
  const md = [
    '| # | Scenario | Final status | Attempts | Evidence | Result |', '|---|---|---|---|---|---|',
    ...results.map(({ case: c, response: r, problems, pass }) => r
      ? `| ${c.id} | ${c.name} | ${r.status} | ${r.attempts_used ?? r.attempts} | ${String(r.Notes ?? (r.failures ?? []).join(' | ')).replace(/\|/g, '/').slice(0, 160)} | ${pass ? 'PASS' : 'FAIL: ' + problems.join('; ')} |`
      : `| ${c.id} | ${c.name} | - | - | - | FAIL: ${problems.join('; ')} |`),
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'guardrail_results.md'), md + '\n');
  console.log(`\n${results.filter((x) => x.pass).length}/${results.length} passed. Wrote tests/guardrail_results.json and .md`);
})();
