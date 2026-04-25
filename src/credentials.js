const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readCredentials() {
  if (process.platform === 'darwin') {
    const fromKeychain = readMacKeychain();
    if (fromKeychain) return fromKeychain;
  }
  return readCredentialsFile();
}

function readMacKeychain() {
  try {
    const out = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    return parseCredentialPayload(out);
  } catch {
    return null;
  }
}

function readCredentialsFile() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.claude', '.credentials.json'),
    path.join(home, '.config', 'claude', 'credentials.json'),
    path.join(home, '.config', 'claude-code', 'credentials.json'),
  ];
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'claude', 'credentials.json'));
    candidates.push(path.join(process.env.APPDATA, 'Claude', 'credentials.json'));
  }
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = parseCredentialPayload(raw);
      if (parsed) return parsed;
    } catch {}
  }
  return null;
}

function parseCredentialPayload(raw) {
  try {
    const data = JSON.parse(raw);
    const oauth = data.claudeAiOauth || data;
    if (!oauth || typeof oauth !== 'object') return null;
    if (!oauth.accessToken) return null;
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? null,
      expiresAt: oauth.expiresAt ?? null,
      subscriptionType: oauth.subscriptionType ?? '',
      rateLimitTier: oauth.rateLimitTier ?? '',
    };
  } catch {
    return null;
  }
}

module.exports = { readCredentials };
