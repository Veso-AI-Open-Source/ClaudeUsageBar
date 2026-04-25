const https = require('https');

function fetchUsage(accessToken) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'ClaudeUsageBar/2.0',
        Accept: 'application/json',
      },
      timeout: 10_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ ok: true, data: JSON.parse(body) });
          } catch {
            resolve({ ok: false, status: res.statusCode, error: 'parse-error' });
          }
        } else {
          resolve({ ok: false, status: res.statusCode, error: body.slice(0, 200) });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message, code: err.code }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

module.exports = { fetchUsage };
