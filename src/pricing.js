function rates(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 };
  if (m.includes('haiku')) return { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 };
  return { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };
}

function cost({ model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  const r = rates(model);
  return (
    (input * r.input) / 1_000_000 +
    (output * r.output) / 1_000_000 +
    (cacheRead * r.cacheRead) / 1_000_000 +
    (cacheWrite * r.cacheWrite) / 1_000_000
  );
}

function displayName(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('haiku')) return 'Haiku';
  if (m.includes('sonnet')) return 'Sonnet';
  return model || 'unknown';
}

module.exports = { cost, displayName };
