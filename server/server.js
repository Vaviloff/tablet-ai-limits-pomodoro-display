#!/usr/bin/env node
// Tablet dashboard backend: serves web/ and /api/limits (Claude Code + Codex usage).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const WEB_DIR = path.join(__dirname, '..', 'web');
const CACHE_MS = 60 * 1000;
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const CLAUDE_CREDS = path.join(CLAUDE_DIR, '.credentials.json');
// Refreshing rotates the refresh token, which logs out any other Claude Code using the same
// credentials file. Only enable it for a login dedicated to this server (the Docker image does).
const CLAUDE_REFRESH = process.env.CLAUDE_REFRESH === '1';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Claude Code's OAuth client
const CODEX_BIN = process.env.CODEX_BIN || 'codex';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Window shape shared by both providers: { used: 0-100, resets_at: epoch ms, window_min }
function win(used, resetsAtMs, windowMin) {
  return { used: Math.round(used), resets_at: resetsAtMs, window_min: windowMin };
}

async function refreshClaude(file, creds) {
  const res = await fetch(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
      scope: (creds.scopes || []).join(' '),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('Claude token refresh HTTP ' + res.status);
  const t = await res.json();
  const next = Object.assign({}, creds, {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || creds.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
  });
  if (t.scope) next.scopes = t.scope.split(' ');
  file.claudeAiOauth = next;
  // write-then-rename so a crash never leaves a half-written credentials file
  fs.writeFileSync(CLAUDE_CREDS + '.tmp', JSON.stringify(file), { mode: 0o600 });
  fs.renameSync(CLAUDE_CREDS + '.tmp', CLAUDE_CREDS);
  return next;
}

async function fetchClaude() {
  const file = JSON.parse(fs.readFileSync(CLAUDE_CREDS, 'utf8'));
  let creds = file.claudeAiOauth;
  if (!creds || !creds.accessToken) throw new Error('no Claude OAuth token');
  if (creds.expiresAt && creds.expiresAt < Date.now() + 5 * 60 * 1000) {
    if (!CLAUDE_REFRESH) throw new Error('Claude token expired, run claude once to refresh');
    creds = await refreshClaude(file, creds);
  }
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: 'Bearer ' + creds.accessToken,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.0',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('Claude usage HTTP ' + res.status);
  const d = await res.json();
  const w = (x, min) => (x ? win(x.utilization, Date.parse(x.resets_at), min) : null);
  return {
    plan: creds.subscriptionType || null,
    five_hour: w(d.five_hour, 300),
    weekly: w(d.seven_day, 10080),
  };
}

// codex app-server speaks newline-delimited JSON-RPC over stdio.
function fetchCodex() {
  return new Promise((resolve, reject) => {
    const proc = spawn(CODEX_BIN, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => finish(new Error('codex app-server timeout')), 20000);
    let buf = '';
    let done = false;

    function finish(err, val) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      proc.kill();
      err ? reject(err) : resolve(val);
    }
    function send(msg) {
      proc.stdin.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, msg)) + '\n');
    }

    proc.on('error', finish);
    proc.on('exit', () => finish(new Error('codex app-server exited')));
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch (e) { continue; }
        if (msg.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read' });
        } else if (msg.id === 2) {
          if (msg.error) return finish(new Error(msg.error.message || 'codex error'));
          const rl = msg.result.rateLimits;
          const w = (x) => (x ? win(x.usedPercent, x.resetsAt * 1000, x.windowDurationMins) : null);
          const resets = msg.result.rateLimitResetCredits;
          finish(null, {
            plan: rl.planType || null,
            five_hour: w(rl.primary),
            weekly: w(rl.secondary),
            reset_credits: resets ? resets.availableCount : null,
          });
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'tablet-dash', version: '0.1' } } });
  });
}

// Each provider keeps its last good value so one failure doesn't blank the screen.
const providers = { claude: fetchClaude, codex: fetchCodex };
const state = {};
let inflight = null;

async function refresh() {
  await Promise.all(Object.keys(providers).map(async (name) => {
    const prev = state[name] || {};
    try {
      state[name] = { data: await providers[name](), ok_at: Date.now(), error: null };
    } catch (e) {
      state[name] = { data: prev.data || null, ok_at: prev.ok_at || null, error: String(e.message || e) };
      console.error(new Date().toISOString(), name, e.message || e);
    }
  }));
  state.fetched_at = Date.now();
}

function getLimits() {
  if (state.fetched_at && Date.now() - state.fetched_at < CACHE_MS) return Promise.resolve(state);
  if (!inflight) inflight = refresh().finally(() => { inflight = null; });
  return inflight.then(() => state);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(WEB_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(WEB_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  });
}

http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/limits') {
    getLimits().then((s) => {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(Object.assign({ now: Date.now() }, s)));
    }, (e) => {
      res.writeHead(500, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ error: String(e) }));
    });
    return;
  }
  serveStatic(req, res);
}).listen(PORT, HOST, () => {
  console.log('tablet-dash listening on http://' + HOST + ':' + PORT);
});
