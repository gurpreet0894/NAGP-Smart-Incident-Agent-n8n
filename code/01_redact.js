// Code node: "Redact Sensitive Text"  (mode: Run Once for All Items)
// Guardrail: mask emails, phone numbers, long numbers / card numbers and token-like secrets
// BEFORE any text reaches the LLM. Only the redacted fields are passed downstream.

const input = $input.first().json;
const counts = { EMAIL: 0, SECRET: 0, 'CARD/NUMBER': 0, PHONE: 0 };

function redact(text) {
  let t = String(text ?? '');

  // 1. Email addresses
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => {
    counts.EMAIL++;
    return '[EMAIL]';
  });

  // 2. Known secret formats: Bearer tokens, JWTs, sk-/pk- keys, AWS keys, GitHub tokens
  const secretPatterns = [
    /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  ];
  for (const re of secretPatterns) {
    t = t.replace(re, () => {
      counts.SECRET++;
      return '[SECRET]';
    });
  }

  // 3. Card-like numbers: 13-19 digits, optionally separated by spaces or dashes
  t = t.replace(/(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g, () => {
    counts['CARD/NUMBER']++;
    return '[CARD/NUMBER]';
  });

  // 4. Phone numbers: candidate with 10-15 digits in total (so "500 customers" is untouched)
  t = t.replace(/(?<![\w])\+?\(?\d[\d\s().-]{8,}\d(?![\w])/g, (m) => {
    const digits = m.replace(/\D/g, '').length;
    if (digits >= 10 && digits <= 15) {
      counts.PHONE++;
      return '[PHONE]';
    }
    return m;
  });

  // 5. Any remaining long digit run (9+ digits), e.g. an account or order reference
  t = t.replace(/(?<![\w])\d{9,}(?![\w])/g, () => {
    counts['CARD/NUMBER']++;
    return '[CARD/NUMBER]';
  });

  // 6. Generic token-like strings: 20+ chars of [A-Za-z0-9_-] mixing letters and digits
  t = t.replace(/(?<![\w-])[A-Za-z0-9_-]{20,}(?![\w-])/g, (m) => {
    if (/\d/.test(m) && /[A-Za-z]/.test(m)) {
      counts.SECRET++;
      return '[SECRET]';
    }
    return m;
  });

  return t;
}

const redacted_error_summary = redact(input.error_summary);
const redacted_specific_error = redact(input.specific_error) || 'None reported';

// Basic input hygiene so the rest of the workflow never sees NaN
const toNumber = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const total = Object.values(counts).reduce((a, b) => a + b, 0);

return [
  {
    json: {
      redacted_error_summary,
      redacted_specific_error,
      users_affected: Math.max(0, Math.round(toNumber(input.users_affected))),
      minutes_since_start: Math.max(0, Math.round(toNumber(input.minutes_since_start))),
      redaction_count: total,
      redaction_types: Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} x${n}`),
    },
  },
];
