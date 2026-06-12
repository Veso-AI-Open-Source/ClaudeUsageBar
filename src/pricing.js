// Per-million-token rates (USD) for Anthropic Claude API.
// Source: https://www.anthropic.com/pricing (public API list price).
// Cache-read = 0.1× input, cache-write (5-minute TTL) = 1.25× input.
// Sonnet "long context" tier applies when a single request's input exceeds
// 200K tokens; rates double on the input side. Fable/Mythos and Opus 4.5+
// have a 1M window at flat pricing — no long-context tier.
//
// Prices go stale — bump LAST_VERIFIED whenever you re-check the page above.
// Override at runtime by pointing CLAUDE_USAGE_PRICING_JSON at a JSON file
// shaped like the RATES object below; matching keys overwrite, others stay.
const LAST_VERIFIED = '2026-06-12';

const DEFAULT_RATES = {
  fable:       { input: 10.0, output: 50.0,  cacheRead: 1.0,  cacheWrite: 12.5  },
  opus:        { input:  5.0, output: 25.0,  cacheRead: 0.5,  cacheWrite:  6.25 },
  opusLegacy:  { input: 15.0, output: 75.0,  cacheRead: 1.5,  cacheWrite: 18.75 },
  sonnet:      { input:  3.0, output: 15.0,  cacheRead: 0.3,  cacheWrite:  3.75 },
  sonnetLong:  { input:  6.0, output: 22.5,  cacheRead: 0.6,  cacheWrite:  7.5  },
  haiku45:     { input:  1.0, output:  5.0,  cacheRead: 0.1,  cacheWrite:  1.25 },
  haiku35:     { input:  0.8, output:  4.0,  cacheRead: 0.08, cacheWrite:  1.0  },
  haiku3:      { input: 0.25, output: 1.25,  cacheRead: 0.03, cacheWrite:  0.3  },
};

const RATES = loadRates();

function loadRates() {
  const overridePath = process.env.CLAUDE_USAGE_PRICING_JSON;
  if (!overridePath) return { ...DEFAULT_RATES };
  try {
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    return { ...DEFAULT_RATES, ...data };
  } catch (e) {
    console.warn('[pricing] failed to load CLAUDE_USAGE_PRICING_JSON:', e.message);
    return { ...DEFAULT_RATES };
  }
}

const LONG_CONTEXT_THRESHOLD = 200_000;

function family(model) {
  const m = (model || '').toLowerCase();
  // Fable class: claude-fable-5, claude-mythos-5, claude-mythos-preview —
  // all share Fable-tier pricing ($10/$50).
  if (m.includes('fable') || m.includes('mythos')) return 'fable';
  if (m.includes('opus')) return opusFamily(m);
  if (m.includes('haiku')) {
    if (m.includes('haiku-4') || m.includes('haiku4')) return 'haiku45';
    if (m.includes('3-5-haiku') || m.includes('haiku-3-5')) return 'haiku35';
    if (m.includes('haiku')) return 'haiku3';
  }
  return 'sonnet';
}

function opusFamily(m) {
  // Opus 4.5+ is $5/$25; Opus 4.0/4.1 and Opus 3 were $15/$75.
  if (m.includes('3-opus')) return 'opusLegacy';
  // A 4+-digit second number is a date suffix (claude-opus-4-20250514),
  // not a minor version.
  const match = m.match(/opus-(\d+)(?:-(\d+))?/);
  if (!match) return 'opus'; // bare "opus" alias → current Opus tier
  const major = parseInt(match[1], 10);
  const minor = match[2] && match[2].length < 4 ? parseInt(match[2], 10) : 0;
  if (major > 4 || (major === 4 && minor >= 5)) return 'opus';
  return 'opusLegacy';
}

function rates(model, totalInput = 0) {
  const f = family(model);
  if (f === 'sonnet' && totalInput > LONG_CONTEXT_THRESHOLD) return RATES.sonnetLong;
  return RATES[f];
}

function cost({ model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  // Long-context tier is triggered by the per-request input footprint, which
  // for a Claude Code log line is input + cacheRead + cacheWrite.
  const totalInput = input + cacheRead + cacheWrite;
  const r = rates(model, totalInput);
  return (
    (input * r.input) / 1_000_000 +
    (output * r.output) / 1_000_000 +
    (cacheRead * r.cacheRead) / 1_000_000 +
    (cacheWrite * r.cacheWrite) / 1_000_000
  );
}

function version(model) {
  const m = (model || '').toLowerCase();
  // Match "claude-fable-5", "claude-mythos-5" (single-number versions).
  const single = m.match(/(fable|mythos)-(\d+)(?:-(\d+))?/);
  if (single) {
    // A 4+-digit second number is a date suffix, not a minor version.
    return single[3] && single[3].length < 4 ? `${single[2]}.${single[3]}` : single[2];
  }
  // Match "claude-opus-4-7", "claude-sonnet-4-5", "claude-haiku-4-5", etc.
  const v = m.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (v && v[3].length < 4) return `${v[2]}.${v[3]}`;
  if (v) return v[2]; // date-suffixed like "claude-opus-4-20250514"
  // Older "claude-3-5-sonnet" / "claude-3-haiku" style.
  const legacy = m.match(/claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)/);
  if (legacy) return legacy[2] ? `${legacy[1]}.${legacy[2]}` : `${legacy[1]}`;
  return null;
}

function displayName(model) {
  const f = family(model);
  const m = (model || '').toLowerCase();
  const base = f === 'fable' ? (m.includes('mythos') ? 'Mythos' : 'Fable')
    : (f === 'opus' || f === 'opusLegacy') ? 'Opus'
    : f === 'sonnet' ? 'Sonnet'
    : 'Haiku';
  const v = version(model);
  return v ? `${base} ${v}` : (model || base);
}

module.exports = { cost, displayName, family, LAST_VERIFIED };
