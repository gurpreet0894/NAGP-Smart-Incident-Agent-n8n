// Measures the success criterion: "the agent calls the incident history tool when symptoms may match a past incident,
// and does not when they clearly do not". Each case is sent several times to the TEST-webhook workflow; the result is the
// rate at which the history tool was (not) called. Writes tests/results/<date>_tool-use.json and .md.
// Usage:  node tests/run_tool_use_cases.js <production-webhook-url> [repeats=3] [gapSeconds=2]
const fs = require('fs');
const path = require('path');

const [url, repArg, gapArg] = process.argv.slice(2);
if (!url) { console.error('Usage: node tests/run_tool_use_cases.js <webhook-url> [repeats] [gapSeconds]'); process.exit(1); }
const repeats = Number(repArg ?? 3);
const gap = Number(gapArg ?? 2) * 1000;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'tool_use_cases.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(c) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c.input) });
    const text = await res.text();
    try { return { r: JSON.parse(text) }; } catch { return { err: `HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 100)}` }; }
  } catch (e) { return { err: String(e) }; }
}

function verdict(c, r) {
  if (!r.status || r.status === 'manual_routing_required') return { ok: false, why: 'workflow ended in manual routing' };
  const called = !!r.history_tool_called;
  if (c.group === 'skip') {
    if (called) return { ok: false, why: 'history tool was called for an unrelated issue' };
    if (r.matched_incident_id !== 'None') return { ok: false, why: `cited ${r.matched_incident_id} without the tool` };
    return { ok: true };
  }
  return called ? { ok: true } : { ok: false, why: 'history tool was not called although the symptoms could match' };
}

(async () => {
  const runs = [];
  for (const c of cases) {
    for (let i = 1; i <= repeats; i++) {
      const started = Date.now();
      const { r, err } = await send(c);
      const v = err ? { ok: false, why: err } : verdict(c, r);
      runs.push({ id: c.id, group: c.group, name: c.name, run: i, seconds: Math.round((Date.now() - started) / 1000),
        status: r?.status ?? null, team: r?.team ?? null, tools_called: r?.tools_called ?? null, history_tool_called: r?.history_tool_called ?? null,
        matched_incident_id: r?.matched_incident_id ?? null, why: r?.Why ?? null, ok: v.ok, problem: v.why ?? null });
      console.log(`${c.id} run ${i}/${repeats} [${c.group}] tools=${(r?.tools_called ?? []).join('>') || '-'} incident=${r?.matched_incident_id ?? '-'} -> ${v.ok ? 'OK' : 'FAIL: ' + v.why}`);
      await sleep(gap);
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}_tool-use.json`), JSON.stringify(runs, null, 2));

  const sum = (g) => { const x = runs.filter((r) => r.group === g); return { ok: x.filter((r) => r.ok).length, n: x.length }; };
  const skip = sum('skip'), call = sum('call');
  const rows = cases.map((c) => {
    const x = runs.filter((r) => r.id === c.id);
    const called = x.filter((r) => r.history_tool_called).length;
    return `| ${c.id} | ${c.group === 'skip' ? 'should be skipped' : 'should be called'} | ${c.name} | ${called} of ${x.length} | ${x.filter((r) => r.ok).length} of ${x.length} |`;
  });
  const md = [
    `Tool-use test, ${date}: ${repeats} runs per case.`, '',
    `- Unrelated issues, history tool correctly skipped: **${skip.ok} of ${skip.n}**`,
    `- Plausible matches, history tool correctly called: **${call.ok} of ${call.n}**`, '',
    '| # | Expected | Scenario | Runs where the history tool was called | Runs as expected |', '|---|---|---|---|---|', ...rows, '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${date}_tool-use.md`), md);
  console.log(`\nSkipped correctly: ${skip.ok}/${skip.n} | Called correctly: ${call.ok}/${call.n}\nWrote tests/results/${date}_tool-use.json and .md`);
})();
