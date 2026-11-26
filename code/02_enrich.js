// Code node: "Enrich Context"  (mode: Run Once for All Items)
// Derives severity_hint (low / medium / high) and urgency (new / ongoing / prolonged).
//
// SEVERITY  = base level from customers affected, bumped one level when the text suggests
//             money is involved or a security problem (capped at "high").
//     users_affected <   50  -> low
//     users_affected <  500  -> medium
//     users_affected >= 500  -> high
//     +1 level if payment / checkout / charged / refund / ... OR security wording is present
//
// URGENCY   = how long the incident has been running.
//     minutes_since_start <  15 -> new
//     minutes_since_start <= 60 -> ongoing
//     minutes_since_start >  60 -> prolonged

const d = $input.first().json;
const text = `${d.redacted_error_summary} ${d.redacted_specific_error}`.toLowerCase();

const LEVELS = ['low', 'medium', 'high'];
const baseIdx = d.users_affected >= 500 ? 2 : d.users_affected >= 50 ? 1 : 0;

const moneyRe = /(\bcharg(e|ed|es|ing)\b|payment|\bpay\b|checkout|card|refund|declin|billing|money)/;
const securityRe = /(hack|breach|leak|fraud|stolen|unauthori[sz]ed|security)/;

const reasons = [`${d.users_affected} customers affected -> base "${LEVELS[baseIdx]}"`];
let idx = baseIdx;
if (moneyRe.test(text)) {
  idx = Math.min(2, idx + 1);
  reasons.push('payment/money wording found -> raised one level');
} else if (securityRe.test(text)) {
  idx = Math.min(2, idx + 1);
  reasons.push('security wording found -> raised one level');
}
const severity_hint = LEVELS[idx];

const m = d.minutes_since_start;
const urgency = m < 15 ? 'new' : m <= 60 ? 'ongoing' : 'prolonged';

return [
  {
    json: {
      ...d,
      severity_hint,
      severity_reason: reasons.join('; '),
      urgency,
      urgency_reason: `${m} minutes since first report -> ${urgency}`,
    },
  },
];
