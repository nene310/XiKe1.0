require('dotenv').config({ override: true, path: require('path').join(__dirname, '.env') }); // 这行必须在最前面，注入环境变量
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const pathMod = require('path');

const env = (k, d = undefined) => (process.env[k] === undefined ? d : process.env[k]);

const PORT = Number(env('PORT', '3001')); //debug PORT 3001, should be changed before release
const REQUIRE_AUTH = String(env('REQUIRE_AUTH', 'true')).toLowerCase() !== 'false';
const REQUIRE_SAME_ORIGIN = String(env('REQUIRE_SAME_ORIGIN', 'true')).toLowerCase() !== 'false';

const LLM_BASE_URL = String(env('LLM_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1')).replace(/\/$/, '');
const LLM_API_KEY = String(env('LLM_API_KEY', ''));
const DEFAULT_MODEL = String(env('LLM_MODEL', 'qwen-flash'));

const MAX_PDF_BODY_BYTES = Number(env('MAX_PDF_BODY_BYTES', '52428800'));
const DEFAULT_PYTHON_BIN = (() => {
  const venvDir = pathMod.join(__dirname, 'pdfplumber-fastapi-service', '.venv');
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(pathMod.join(venvDir, 'Scripts', 'python.exe'));
    candidates.push('python');
  } else {
    candidates.push(pathMod.join(venvDir, 'bin', 'python'));
    candidates.push('python3');
    candidates.push('python');
  }
  for (const c of candidates) {
    if (pathMod.isAbsolute(c) && fs.existsSync(c)) return c;
    if (!pathMod.isAbsolute(c)) return c;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
})();
const PYTHON_BIN = String(env('PYTHON_BIN', DEFAULT_PYTHON_BIN));
const PDF_PARSER_PY = String(env('PDF_PARSER_PY', pathMod.join(__dirname, 'pdfplumber-fastapi-service', 'main.py')));
const PDF_PARSE_TIMEOUT_MS = Number(env('PDF_PARSE_TIMEOUT_MS', '120000'));

const AUTH_USER = String(env('AUTH_USER', 'admin'));
const AUTH_PASS = String(env('AUTH_PASS', ''));
const JWT_SECRET = String(env('JWT_SECRET', ''));
const JWT_TTL_SECONDS = Number(env('JWT_TTL_SECONDS', '43200'));

const RATE_LIMIT_RPM = Number(env('RATE_LIMIT_RPM', '120'));
const MAX_BODY_BYTES = Number(env('MAX_BODY_BYTES', '1048576'));
const MAX_LLM_BODY_BYTES = Number(env('MAX_LLM_BODY_BYTES', '12582912'));
const ALLOWED_ORIGINS = String(env('ALLOWED_ORIGINS', '')).split(',').map(s => s.trim()).filter(Boolean);

const COOKIE_NAME = String(env('AUTH_COOKIE_NAME', 'schedulellm_token'));
const COOKIE_SECURE = String(env('COOKIE_SECURE', 'true')).toLowerCase() !== 'false';

function nowMs() { return Date.now(); }

function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64');
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function jwtSignHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64urlEncode(JSON.stringify(header));
  const p = base64urlEncode(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64urlEncode(sig)}`;
}

function jwtVerifyHS256(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, err: 'bad_token' };
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const got = base64urlDecode(s);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return { ok: false, err: 'bad_sig' };
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(p).toString('utf8'));
  } catch {
    return { ok: false, err: 'bad_payload' };
  }
  const exp = Number(payload.exp || 0) * 1000;
  if (exp && nowMs() > exp) return { ok: false, err: 'expired' };
  return { ok: true, payload };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sendJson(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    ...headers
  });
  res.end(body);
}

function sendText(res, status, text, headers = {}) {
  const body = Buffer.from(String(text || ''), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(body.length),
    ...headers
  });
  res.end(body);
}

function sendBytes(res, status, buf, contentType, headers = {}) {
  const body = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  res.writeHead(status, {
    'Content-Type': String(contentType || 'application/octet-stream'),
    'Content-Length': String(body.length),
    ...headers
  });
  res.end(body);
}

const PDFJS_CDN_BASE = String(env('PDFJS_CDN_BASE', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379')).replace(/\/$/, '');
const PDFJS_CACHE_TTL_MS = Number(env('PDFJS_CACHE_TTL_MS', String(24 * 60 * 60 * 1000)));
const pdfjsAssetCache = new Map();

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getPdfJsAsset(name) {
  const key = String(name || '').trim();
  if (!key) return { ok: false, err: 'missing_name' };

  const cached = pdfjsAssetCache.get(key);
  if (cached && cached.buf && cached.etag && cached.at && (nowMs() - cached.at) < PDFJS_CACHE_TTL_MS) {
    return { ok: true, ...cached };
  }

  const url = `${PDFJS_CDN_BASE}/${encodeURIComponent(key)}`;
  let resp;
  try {
    resp = await fetchWithTimeout(url, 20000);
  } catch (e) {
    return { ok: false, err: 'fetch_failed', detail: e && e.message ? e.message : String(e) };
  }

  if (!resp || !resp.ok) {
    return { ok: false, err: 'bad_upstream', status: resp ? resp.status : 0 };
  }

  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  const etag = `W/"${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}"`;
  const rec = { buf, etag, at: nowMs() };
  pdfjsAssetCache.set(key, rec);
  return { ok: true, ...rec };
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('body_too_large'), { code: 'body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({ raw: '', json: null });
      try {
        return resolve({ raw, json: JSON.parse(raw) });
      } catch (e) {
        reject(Object.assign(new Error('bad_json'), { code: 'bad_json', detail: e.message }));
      }
    });
    req.on('error', reject);
  });
}

function readRaw(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('body_too_large'), { code: 'body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getMultipartBoundary(contentType) {
  const s = String(contentType || '');
  const m = s.match(/boundary=([^;]+)/i);
  if (!m) return '';
  let b = String(m[1] || '').trim();
  if ((b.startsWith('"') && b.endsWith('"')) || (b.startsWith("'") && b.endsWith("'"))) {
    b = b.slice(1, -1);
  }
  return b;
}

function extractMultipartFile(buf, boundary, fieldName = 'file') {
  const b = String(boundary || '');
  if (!b) return null;

  const boundaryBuf = Buffer.from(`--${b}`);
  const headerSep = Buffer.from('\r\n\r\n');
  const crlf = Buffer.from('\r\n');

  let pos = 0;
  while (true) {
    const start = buf.indexOf(boundaryBuf, pos);
    if (start < 0) break;
    const afterBoundary = start + boundaryBuf.length;
    const next = buf.indexOf(boundaryBuf, afterBoundary);
    const end = next >= 0 ? next : buf.length;

    const part = buf.slice(afterBoundary, end);
    pos = afterBoundary;

    if (part.length === 0) continue;

    let p = part;
    if (p.slice(0, 2).equals(crlf)) p = p.slice(2);
    if (p.length === 0) continue;
    if (p.slice(0, 2).equals(Buffer.from('--'))) break;

    const hs = p.indexOf(headerSep);
    if (hs < 0) continue;
    const headerRaw = p.slice(0, hs).toString('utf8');
    let body = p.slice(hs + headerSep.length);
    if (body.length >= 2 && body.slice(body.length - 2).equals(crlf)) {
      body = body.slice(0, body.length - 2);
    }

    const cdLine = headerRaw.split('\r\n').find(l => /^content-disposition:/i.test(l)) || '';
    const nameM = cdLine.match(/name="([^"]+)"/i);
    const fileM = cdLine.match(/filename="([^"]*)"/i);
    const name = nameM ? nameM[1] : '';
    const filename = fileM ? fileM[1] : '';
    if (!name || name !== fieldName || !filename) continue;

    const ctLine = headerRaw.split('\r\n').find(l => /^content-type:/i.test(l)) || '';
    const ctM = ctLine.match(/^content-type:\s*(.+)$/i);
    const contentType = ctM ? ctM[1].trim() : '';
    return { filename, contentType, data: body };
  }
  return null;
}

async function runPdfParserCli(filePath) {
  return await new Promise((resolve, reject) => {
    const args = [PDF_PARSER_PY, '--cli', filePath];
    const child = spawn(PYTHON_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
    }, Math.max(1000, PDF_PARSE_TIMEOUT_MS));

    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c) => { err += c.toString('utf8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(Object.assign(new Error('spawn_failed'), { detail: e && e.message ? e.message : String(e) }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(Object.assign(new Error('parser_exit_nonzero'), { code, stderr: err.slice(0, 4000), stdout: out.slice(0, 4000) }));
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

const rate = new Map();
function rateLimitKey(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  const ip = xf.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  return ip;
}
function rateLimitAllow(key, limitPerMin) {
  const t = nowMs();
  const w = 60_000;
  const rec = rate.get(key) || { win: Math.floor(t / w), count: 0 };
  const win = Math.floor(t / w);
  if (rec.win !== win) {
    rec.win = win;
    rec.count = 0;
  }
  rec.count += 1;
  rate.set(key, rec);
  return rec.count <= limitPerMin;
}

const nonceStore = new Map();
function rememberNonce(subject, nonce, ttlMs = 5 * 60_000) {
  const t = nowMs();
  const exp = t + ttlMs;
  const key = `${subject}::${nonce}`;
  nonceStore.set(key, exp);
}
function seenNonce(subject, nonce) {
  const t = nowMs();
  const key = `${subject}::${nonce}`;
  const exp = nonceStore.get(key);
  if (!exp) return false;
  if (t > exp) {
    nonceStore.delete(key);
    return false;
  }
  return true;
}
setInterval(() => {
  const t = nowMs();
  for (const [k, exp] of nonceStore.entries()) {
    if (t > exp) nonceStore.delete(k);
  }
  for (const [k, v] of rate.entries()) {
    if (!v || typeof v.win !== 'number') rate.delete(k);
  }
}, 30_000).unref();

function corsHeaders(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return {};
  if (ALLOWED_ORIGINS.length === 0) return {};
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };
}

function requestExpectedOrigin(req) {
  const proto0 = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = proto0 || 'http';
  const host = String(req.headers.host || '');
  return host ? `${proto}://${host}` : '';
}

function originFromHeaderValue(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function isSameOriginAllowed(req) {
  const expected = requestExpectedOrigin(req);
  if (!expected) return true;

  const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim();
  if (secFetchSite && secFetchSite !== 'same-origin') return false;

  const origin = originFromHeaderValue(req.headers.origin);
  if (origin) return origin === expected;

  const referer = originFromHeaderValue(req.headers.referer);
  if (referer) return referer === expected;

  return false;
}

function setAuthCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${JWT_TTL_SECONDS}`
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getAuthSubject(req) {
  const authz = String(req.headers.authorization || '');
  if (authz.startsWith('Bearer ')) {
    const token = authz.slice('Bearer '.length).trim();
    if (!JWT_SECRET) return { ok: false, err: 'no_jwt_secret' };
    const v = jwtVerifyHS256(token, JWT_SECRET);
    if (!v.ok) return { ok: false, err: v.err };
    return { ok: true, sub: String(v.payload.sub || ''), payload: v.payload };
  }

  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return { ok: false, err: 'no_token' };
  if (!JWT_SECRET) return { ok: false, err: 'no_jwt_secret' };
  const v = jwtVerifyHS256(token, JWT_SECRET);
  if (!v.ok) return { ok: false, err: v.err };
  return { ok: true, sub: String(v.payload.sub || ''), payload: v.payload };
}

async function forwardToLLM(body) {
  if (!LLM_API_KEY) {
    return { ok: false, status: 500, data: { error: 'server_missing_llm_api_key' } };
  }

  const model = String(body?.model || DEFAULT_MODEL);
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  const temperature = body?.temperature === undefined ? 0.1 : Number(body.temperature);

  if (!messages || messages.length === 0) {
    return { ok: false, status: 400, data: { error: 'missing_messages' } };
  }

  const upstream = `${LLM_BASE_URL}/chat/completions`;
  const resp = await fetch(upstream, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({ model, messages, temperature })
  });

  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }

  if (!resp.ok) {
    return { ok: false, status: resp.status, data: json || { error: 'upstream_error', raw: text.slice(0, 2000) } };
  }
  return { ok: true, status: 200, data: json };
}

function stripCodeFences(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('```')) return t;
  const firstNl = t.indexOf('\n');
  const inner = firstNl >= 0 ? t.slice(firstNl + 1) : '';
  return inner.replace(/```\s*$/i, '').trim();
}

function normalizeJsonLikeText(text) {
  let s = String(text || '').trim();
  if (!s) return s;

  s = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',');

  s = s.replace(/,\s*([}\]])/g, '$1');
  return s.trim();
}

function escapeControlCharsInJsonStrings(text) {
  const s = String(text || '');
  if (!s) return s;

  let out = '';
  let inStr = false;
  let esc = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (!inStr) {
      if (ch === '"') {
        inStr = true;
        out += ch;
        continue;
      }
      out += ch;
      continue;
    }

    if (esc) {
      esc = false;
      out += ch;
      continue;
    }

    if (ch === '\\') {
      esc = true;
      out += ch;
      continue;
    }

    if (ch === '"') {
      inStr = false;
      out += ch;
      continue;
    }

    if (ch === '\n') {
      out += '\\n';
      continue;
    }

    if (ch === '\r') {
      out += '\\r';
      continue;
    }

    if (ch === '\t') {
      out += '\\t';
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code >= 0 && code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }

    out += ch;
  }

  return out;
}

function extractBalancedJsonCandidate(text) {
  const s = String(text || '');
  if (!s) return '';

  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const start = (firstObj >= 0 && firstArr >= 0) ? Math.min(firstObj, firstArr)
    : (firstObj >= 0 ? firstObj : firstArr);
  if (start < 0) return '';

  const open = s[start];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
        continue;
      }
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }

    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }

  return '';
}

function tryParseJsonLenient(text) {
  const t0 = stripCodeFences(text);
  if (!t0) return null;

  const candidates = [];
  candidates.push(String(t0));
  candidates.push(normalizeJsonLikeText(t0));

  const balancedA = extractBalancedJsonCandidate(t0);
  if (balancedA) candidates.push(balancedA);

  const norm0 = normalizeJsonLikeText(t0);
  const balancedB = extractBalancedJsonCandidate(norm0);
  if (balancedB) candidates.push(balancedB);

  for (const cand0 of candidates) {
    const cand = escapeControlCharsInJsonStrings(normalizeJsonLikeText(cand0));
    if (!cand) continue;

    try {
      const parsed = JSON.parse(cand);
      if (typeof parsed === 'string') {
        const inner = escapeControlCharsInJsonStrings(normalizeJsonLikeText(parsed));
        try {
          return JSON.parse(inner);
        } catch {
          return parsed;
        }
      }
      return parsed;
    } catch {
    }
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  const t0 = nowMs();
  const rid = String(req.headers['x-request-id'] || crypto.randomUUID());
  res.setHeader('X-Request-Id', rid);

  const c = corsHeaders(req);
  for (const [k, v] of Object.entries(c)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-Id,X-Timestamp,X-Nonce');
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  const key = rateLimitKey(req);
  if (!rateLimitAllow(key, RATE_LIMIT_RPM)) {
    sendJson(res, 429, { error: 'rate_limited', requestId: rid });
    return;
  }

  try {
    if (req.method === 'GET' && (path === '/pdf.min.js' || path === '/pdf.worker.min.js')) {
      const name = path.slice(1);
      const out = await getPdfJsAsset(name);
      if (!out.ok) {
        sendText(res, 502, 'pdfjs_upstream_failed');
        return;
      }

      const inm = String(req.headers['if-none-match'] || '');
      if (inm && out.etag && inm === out.etag) {
        res.writeHead(304, { 'ETag': out.etag, 'Cache-Control': 'public, max-age=86400' });
        res.end();
        return;
      }

      sendBytes(res, 200, out.buf, 'application/javascript; charset=utf-8', {
        'ETag': out.etag,
        'Cache-Control': 'public, max-age=86400'
      });
      return;
    }

    if (req.method === 'GET' && path === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && path === '/api/auth/logout') {
      clearAuthCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && path === '/api/auth/login') {
      const { json } = await readJson(req, MAX_LLM_BODY_BYTES);
      const user = String(json?.username || '');
      const pass = String(json?.password || '');

      if (!JWT_SECRET || !AUTH_PASS) {
        sendJson(res, 500, { error: 'server_auth_not_configured', requestId: rid });
        return;
      }
      if (user !== AUTH_USER || !timingSafeEqualStr(pass, AUTH_PASS)) {
        sendJson(res, 401, { error: 'invalid_credentials', requestId: rid });
        return;
      }

      const iat = Math.floor(nowMs() / 1000);
      const exp = iat + JWT_TTL_SECONDS;
      const token = jwtSignHS256({ sub: user, iat, exp, jti: crypto.randomUUID() }, JWT_SECRET);
      setAuthCookie(res, token);
      sendJson(res, 200, { ok: true, exp, requestId: rid });
      return;
    }

    if (req.method === 'POST' && path === '/api/parse-pdf') {
      if (REQUIRE_SAME_ORIGIN && !isSameOriginAllowed(req)) {
        sendJson(res, 403, { error: 'forbidden', reason: 'origin_not_allowed', requestId: rid });
        return;
      }

      if (REQUIRE_AUTH) {
        const auth = getAuthSubject(req);
        if (!auth.ok || !auth.sub) {
          sendJson(res, 401, { error: 'unauthorized', reason: auth.err, requestId: rid });
          return;
        }

        const ts = Number(req.headers['x-timestamp'] || 0);
        const nonce = String(req.headers['x-nonce'] || '');
        if (!ts || !nonce) {
          sendJson(res, 400, { error: 'missing_timestamp_or_nonce', requestId: rid });
          return;
        }
        const skew = Math.abs(nowMs() - ts);
        if (skew > 2 * 60_000) {
          sendJson(res, 400, { error: 'timestamp_skew_too_large', requestId: rid });
          return;
        }
        if (seenNonce(auth.sub, nonce)) {
          sendJson(res, 409, { error: 'replay_detected', requestId: rid });
          return;
        }
        rememberNonce(auth.sub, nonce);
      }

      const cl = Number(req.headers['content-length'] || 0);
      if (cl && cl > MAX_PDF_BODY_BYTES) {
        sendJson(res, 413, { error: 'payload_too_large', requestId: rid });
        return;
      }

      if (!PDF_PARSER_PY) {
        sendJson(res, 500, { error: 'server_missing_pdf_parser_py', requestId: rid });
        return;
      }

      let buf;
      try {
        buf = await readRaw(req, MAX_PDF_BODY_BYTES);
      } catch (e) {
        if (e && e.code === 'body_too_large') {
          sendJson(res, 413, { error: 'payload_too_large', requestId: rid });
          return;
        }
        sendJson(res, 400, { error: 'bad_request_body', requestId: rid });
        return;
      }

      const boundary = getMultipartBoundary(req.headers['content-type']);
      const fileRec = extractMultipartFile(buf, boundary, 'file');
      if (!fileRec || !fileRec.data || !fileRec.filename) {
        sendJson(res, 400, { error: 'missing_pdf_file', requestId: rid });
        return;
      }

      const lower = String(fileRec.filename).toLowerCase();
      if (!lower.endsWith('.pdf')) {
        sendJson(res, 400, { error: 'not_pdf', requestId: rid });
        return;
      }

      let tmpDir = '';
      let tmpFile = '';
      try {
        tmpDir = await fs.promises.mkdtemp(pathMod.join(os.tmpdir(), 'schedulellm-'));
        tmpFile = pathMod.join(tmpDir, `upload-${Date.now()}.pdf`);
        await fs.promises.writeFile(tmpFile, fileRec.data);

        const { stdout } = await runPdfParserCli(tmpFile);
        let json = null;
        try { json = stdout ? JSON.parse(stdout) : null; } catch { json = null; }
        if (!json) {
          sendJson(res, 502, { error: 'pdf_parser_bad_output', requestId: rid });
          return;
        }

        sendJson(res, 200, json);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const stderr = e && typeof e.stderr === 'string' ? e.stderr : '';
        const stdout = e && typeof e.stdout === 'string' ? e.stdout : '';

        if (stderr) {
          try { process.stderr.write(String(stderr).slice(0, 8000) + '\n'); } catch (_) {}
        }

        sendJson(res, 502, {
          error: 'pdf_parser_failed',
          detail: msg,
          stderr: stderr ? String(stderr).slice(0, 2000) : undefined,
          stdout: stdout ? String(stdout).slice(0, 2000) : undefined,
          requestId: rid
        });
      } finally {
        try {
          if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
        } catch (_) {
        }
      }
      return;
    }

    if (req.method === 'POST' && path === '/api/llm') {
      if (REQUIRE_SAME_ORIGIN && !isSameOriginAllowed(req)) {
        sendJson(res, 403, { error: 'forbidden', reason: 'origin_not_allowed', requestId: rid });
        return;
      }

      if (REQUIRE_AUTH) {
        const auth = getAuthSubject(req);
        if (!auth.ok || !auth.sub) {
          sendJson(res, 401, { error: 'unauthorized', reason: auth.err, requestId: rid });
          return;
        }

        const ts = Number(req.headers['x-timestamp'] || 0);
        const nonce = String(req.headers['x-nonce'] || '');
        if (!ts || !nonce) {
          sendJson(res, 400, { error: 'missing_timestamp_or_nonce', requestId: rid });
          return;
        }
        const skew = Math.abs(nowMs() - ts);
        if (skew > 2 * 60_000) {
          sendJson(res, 400, { error: 'timestamp_skew_too_large', requestId: rid });
          return;
        }
        if (seenNonce(auth.sub, nonce)) {
          sendJson(res, 409, { error: 'replay_detected', requestId: rid });
          return;
        }
        rememberNonce(auth.sub, nonce);
      }

      const { json } = await readJson(req, MAX_BODY_BYTES);
      const out = await forwardToLLM(json);
      sendJson(res, out.status, out.ok ? out.data : { ...out.data, requestId: rid });
      return;
    }


    sendJson(res, 404, { error: 'not_found', requestId: rid });
  } catch (e) {
    sendJson(res, 500, { error: 'server_error', requestId: rid });
  } finally {
    const ms = nowMs() - t0;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      rid,
      ip: rateLimitKey(req),
      method: req.method,
      path,
      status: res.statusCode,
      ms
    });
    process.stdout.write(line + '\n');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'server_listening',
    port: PORT,
    llmBaseUrl: LLM_BASE_URL,
    requireAuth: REQUIRE_AUTH,
    pythonBin: PYTHON_BIN,
    pdfParserPy: PDF_PARSER_PY
  }) + '\n');
});
