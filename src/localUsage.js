const os = require('os');
const fs = require('fs');
const path = require('path');
const { cost, displayName } = require('./pricing');

function emptySummary() {
  return {
    todayTokens: 0, todayCost: 0,
    weekTokens: 0, weekCost: 0,
    monthTokens: 0, monthCost: 0,
    modelBreakdown: {},
    sessionUsage: zeroBucket(),
    weeklyUsage: zeroBucket(),
  };
}

function zeroBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function bucketTotal(b) {
  return b.input + b.output + b.cacheRead + b.cacheWrite;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d) {
  // ISO week starting Monday
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return x;
}

async function parseLocalLogs({ sessionResetAt = null, weeklyResetAt = null } = {}) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const summary = emptySummary();
  if (!safeIsDir(projectsDir)) return summary;

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const sessionWindowStart = sessionResetAt
    ? new Date(sessionResetAt.getTime() - 5 * 3600 * 1000)
    : null;
  const weeklyWindowStart = weeklyResetAt
    ? new Date(weeklyResetAt.getTime() - 7 * 24 * 3600 * 1000)
    : null;

  const files = collectJsonl(projectsDir, monthStart);

  // Claude Code re-emits the same assistant message under multiple parent
  // chains (subagents, resumed sessions). Counting each occurrence inflates
  // totals 1.5–3×. Dedupe by `message.id` across all files in this walk.
  const seenMsgIds = new Set();

  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); }
    catch { continue; }

    const lines = content.split('\n');
    for (const line of lines) {
      if (!line || line.indexOf('"input_tokens"') === -1) continue;
      let obj;
      try { obj = JSON.parse(line); }
      catch { continue; }

      if (obj.type !== 'assistant') continue;
      const message = obj.message;
      if (!message) continue;
      const usage = message.usage;
      if (!usage) continue;

      if (message.id) {
        if (seenMsgIds.has(message.id)) continue;
        seenMsgIds.add(message.id);
      }

      const tsRaw = obj.timestamp;
      if (!tsRaw) continue;
      const ts = new Date(tsRaw);
      if (Number.isNaN(ts.getTime()) || ts < monthStart) continue;

      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheWrite = usage.cache_creation_input_tokens || 0;
      const model = message.model || 'unknown';

      const lineCost = cost({ model, input, output, cacheRead, cacheWrite });
      const tokens = input + output + cacheRead + cacheWrite;
      const dn = displayName(model);

      summary.monthTokens += tokens;
      summary.monthCost += lineCost;
      summary.modelBreakdown[dn] = (summary.modelBreakdown[dn] || 0) + lineCost;

      if (ts >= weekStart) {
        summary.weekTokens += tokens;
        summary.weekCost += lineCost;
      }
      if (ts >= todayStart) {
        summary.todayTokens += tokens;
        summary.todayCost += lineCost;
      }
      if (sessionWindowStart && ts >= sessionWindowStart) {
        addBucket(summary.sessionUsage, input, output, cacheRead, cacheWrite);
      }
      if (weeklyWindowStart && ts >= weeklyWindowStart) {
        addBucket(summary.weeklyUsage, input, output, cacheRead, cacheWrite);
      }
    }
  }

  return summary;
}

function addBucket(b, input, output, cacheRead, cacheWrite) {
  b.input += input;
  b.output += output;
  b.cacheRead += cacheRead;
  b.cacheWrite += cacheWrite;
}

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); }
  catch { return false; }
}

function collectJsonl(root, sinceDate) {
  const out = [];
  const sinceMs = sinceDate.getTime();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs >= sinceMs) out.push(full);
        } catch {}
      }
    }
  }
  return out;
}

module.exports = { parseLocalLogs, bucketTotal };
