// Per-million-token rates (USD) for Anthropic Claude API.
// Source: https://www.anthropic.com/pricing (public API list price).
// Cache-read = 0.1× input, cache-write (5-minute TTL) = 1.25× input.
// Sonnet "long context" tier applies when a single request's input exceeds
// 200K tokens; rates double on the input side.
//
// Prices go stale — bump LAST_VERIFIED whenever you re-check the page above.
// Override at runtime by pointing CLAUDE_USAGE_PRICING_JSON at a JSON file
// shaped like the RATES object below; matching keys overwrite, others stay.
const LAST_VERIFIED = '2026-05-22';

const DEFAULT_RATES = {
  opus:        { input: 15.0, output: 75.0,  cacheRead: 1.5,  cacheWrite: 18.75 },
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
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) {
    if (m.includes('haiku-4') || m.includes('haiku4')) return 'haiku45';
    if (m.includes('3-5-haiku') || m.includes('haiku-3-5')) return 'haiku35';
    if (m.includes('haiku')) return 'haiku3';
  }
  return 'sonnet';
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
  // Match "claude-opus-4-7", "claude-sonnet-4-5", "claude-haiku-4-5", etc.
  const v = m.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (v) return `${v[2]}.${v[3]}`;
  // Older "claude-3-5-sonnet" / "claude-3-haiku" style.
  const legacy = m.match(/claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)/);
  if (legacy) return legacy[2] ? `${legacy[1]}.${legacy[2]}` : `${legacy[1]}`;
  return null;
}

function displayName(model) {
  const f = family(model);
  const base = f === 'opus' ? 'Opus'
    : f === 'sonnet' ? 'Sonnet'
    : 'Haiku';
  const v = version(model);
  return v ? `${base} ${v}` : (model || base);
}

module.exports = { cost, displayName, family, LAST_VERIFIED };
