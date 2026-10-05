'use strict';
/*
  Mississauga Chess Club form server.
  Receives the waitlist, volunteer and contact forms and emails them to MAIL_TO.
  It can also serve the website from the folder above it, so one process runs both
  when testing on your own computer. When the site lives on GitHub Pages, host only
  this server somewhere that runs Node and point the site at it (see the README).
  Only dependency: nodemailer.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

// Tiny .env loader so no extra package is needed. Real environment variables win.
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (e) { /* ignore */ }

const PORT = Number(process.env.PORT) || 3000;
const MAIL_TO = process.env.MAIL_TO || 'joshua.deosaran@gmail.com';
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || '';
const SITE_DIR = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const SERVE_SITE = process.env.SERVE_SITE !== '0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DRY_RUN = process.env.DRY_RUN === '1';
// Sites allowed to post from another address, for example https://yourname.github.io
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

if (!DRY_RUN && !process.env.SMTP_HOST) {
  console.error('\nEmail is not set up, so this server would accept forms and silently send nothing.\n' +
    'Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS (see .env.example), or set DRY_RUN=1 to test without sending.\n');
  process.exit(1);
}

const MAX_BODY = 20 * 1024;
const PER_IP_LIMIT = 5, PER_IP_WINDOW_MS = 10 * 60 * 1000;
const BAD_LIMIT = 30;
const GLOBAL_LIMIT = 120, GLOBAL_WINDOW_MS = 60 * 60 * 1000;

const NIGHTS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const FORMS = {
  waitlist: {
    subject: 'Waitlist request',
    fields: {
      name: { label: 'Player name', max: 100, req: true },
      group: { label: 'Group', max: 10, req: true, oneOf: ['Youth', 'Adult'] },
      age: { label: 'Player age', max: 3, digits: true },
      guardian: { label: 'Parent or guardian', max: 100 },
      email: { label: 'Reply email', max: 200, req: true, email: true },
      phone: { label: 'Phone', max: 30, phone: true },
      level: { label: 'Playing level', max: 60 },
      cfc: { label: 'CFC ID', max: 30 },
      nights: { label: 'Preferred nights', list: NIGHTS },
      notes: { label: 'Notes', max: 2000 }
    },
    // Rules that depend on more than one field.
    check(v) {
      if (v.group === 'Youth') {
        if (!v.age) return 'Please enter the player’s age.';
        const n = Number(v.age);
        if (n < 4 || n > 19) return 'Youth players are aged 4 to 19.';
        if (!v.guardian) return 'Please enter a parent or guardian name for a youth player.';
      }
      return '';
    }
  },
  volunteer: {
    subject: 'Volunteer inquiry',
    fields: {
      name: { label: 'Name', max: 100, req: true },
      email: { label: 'Reply email', max: 200, req: true, email: true },
      nights: { label: 'Nights they can help', list: ['Monday', 'Wednesday', 'Friday'] },
      hs: { label: 'Needs high school volunteer hours', list: ['Yes'] },
      msg: { label: 'Message', max: 2000 }
    }
  },
  contact: {
    subject: 'Question for the club',
    fields: {
      name: { label: 'Name', max: 100, req: true },
      email: { label: 'Reply email', max: 200, req: true, email: true },
      topic: { label: 'Topic', max: 60, oneOf: ['Joining or the waitlist', 'Membership', 'Tournaments', 'Kids and youth', 'Sponsorship', 'Something else'] },
      msg: { label: 'Message', max: 2000, req: true }
    }
  }
};

/* ---------- helpers ---------- */
const clean = (v, max) => String(v == null ? '' : v)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/\r\n?/g, '\n')
  .trim()
  .slice(0, max);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const PHONE_RE = /^[0-9 ()+.–—\-xX]{7,30}$/;

function validate(formKey, input) {
  const def = FORMS[formKey];
  if (!def) return { error: 'Unknown form.' };
  const out = {};
  for (const [key, spec] of Object.entries(def.fields)) {
    const raw = input[key];
    if (spec.list) {
      const arr = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => clean(x, 40));
      const ok = arr.filter((x) => spec.list.includes(x));
      if (ok.length !== arr.length) return { error: 'Invalid choice for ' + spec.label + '.' };
      out[key] = [...new Set(ok)];
      continue;
    }
    let val = clean(Array.isArray(raw) ? raw[0] : raw, spec.max);
    if (spec.max <= 200) val = oneLine(val); // short fields are always a single line
    if (spec.req && !val) return { error: spec.label + ' is required.' };
    if (val && spec.email && !EMAIL_RE.test(val)) return { error: 'Please enter a valid email address.' };
    if (val && spec.phone && !PHONE_RE.test(val)) return { error: 'Please enter a valid phone number.' };
    if (val && spec.oneOf && !spec.oneOf.includes(val)) return { error: 'Invalid choice for ' + spec.label + '.' };
    if (val && spec.digits && !/^\d{1,3}$/.test(val)) return { error: spec.label + ' must be a number.' };
    out[key] = val;
  }
  if (def.check) {
    const problem = def.check(out);
    if (problem) return { error: problem };
  }
  return { values: out, def };
}

function buildMessage(values, def) {
  const rows = [];
  for (const [key, spec] of Object.entries(def.fields)) {
    const v = values[key];
    const text = Array.isArray(v) ? v.join(', ') : v;
    if (text) rows.push([spec.label, text]);
  }
  const subject = oneLine(def.subject + ': ' + values.name).slice(0, 150);
  const text = rows.map(([l, v]) => l + ': ' + v).join('\n') +
    '\n\nSent from the club website form. Reply to this email to answer ' + values.name + '.';
  const html = '<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">' +
    rows.map(([l, v]) => '<tr><td style="vertical-align:top;font-weight:bold;white-space:nowrap">' + esc(l) +
      '</td><td style="white-space:pre-wrap">' + esc(v) + '</td></tr>').join('') +
    '</table><p style="font-family:Arial,sans-serif;color:#666;font-size:13px">Sent from the club website form. Reply to this email to answer ' + esc(values.name) + '.</p>';
  return { subject, text, html };
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transporter;
}
async function sendMail(msg, values) {
  if (DRY_RUN) {
    console.log('[dry run] would email ' + MAIL_TO + '\nSubject: ' + msg.subject + '\n' + msg.text + '\n');
    return;
  }
  await getTransporter().sendMail({
    from: { name: 'MCC website', address: MAIL_FROM || process.env.SMTP_USER },
    to: MAIL_TO,
    replyTo: { name: oneLine(values.name).replace(/["<>]/g, ''), address: values.email },
    subject: msg.subject,
    text: msg.text,
    html: msg.html
  });
}

/* ---------- rate limiting (in memory) ----------
   Two limits per visitor: a strict one for messages that actually get emailed, and a looser
   one for rejected attempts, so someone fixing a typo is never locked out but abuse is capped. */
function makeLimiter(limit, windowMs) {
  const map = new Map();
  const check = (key) => {
    const now = Date.now();
    const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) { map.set(key, arr); return false; }
    arr.push(now); map.set(key, arr);
    return true;
  };
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of map) {
      const keep = arr.filter((t) => now - t < windowMs);
      if (keep.length) map.set(k, keep); else map.delete(k);
    }
  }, 5 * 60 * 1000).unref();
  return check;
}
const sendLimit = makeLimiter(PER_IP_LIMIT, PER_IP_WINDOW_MS);
const badLimit = makeLimiter(BAD_LIMIT, PER_IP_WINDOW_MS);
let globalHits = [];
function allowed(ip) {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_LIMIT) return false;
  if (!sendLimit(ip)) return false;
  globalHits.push(now);
  return true;
}
const clientIp = (req) => {
  if (TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || 'unknown';
};

/* ---------- http ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN'
};
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({}, SEC, headers));
  res.end(body);
}
const json = (res, status, obj, extra) =>
  send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extra));

// Cross site posting is allowed only from the listed origins (or the same address as the server).
function originInfo(req) {
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (!origin) return { ok: true, headers: {} };
  let sameHost = false;
  try { sameHost = new URL(origin).host === req.headers.host; } catch (e) { /* ignore */ }
  if (sameHost) return { ok: true, headers: {} };
  if (ALLOWED_ORIGINS.includes(origin)) return { ok: true, headers: { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } };
  return { ok: false, headers: {} };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > MAX_BODY) { reject(new Error('too large')); req.resume(); return; }
    let size = 0, over = false; const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; reject(new Error('too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(SITE_DIR, urlPath));
  if (!file.startsWith(SITE_DIR + path.sep) && file !== SITE_DIR) return send(res, 403, 'Forbidden');
  // Never serve the server folder, installed packages, or any hidden file such as .env.
  const parts = path.relative(SITE_DIR, file).split(path.sep);
  const hidden = parts.some((p) => p.startsWith('.')) || parts[0] === 'server' || parts[0] === 'node_modules';
  const notFound = () => fs.readFile(path.join(SITE_DIR, '404.html'), (e2, data) =>
    send(res, 404, e2 ? 'Not found' : data, { 'Content-Type': 'text/html; charset=utf-8' }));
  if (hidden) return notFound();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound();
    const ext = path.extname(file).toLowerCase();
    const cache = /\.(png|jpg|jpeg|webp|svg|css|js)$/.test(ext) ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, Object.assign({}, SEC, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache }));
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/api/health') return json(res, 200, { ok: true, dryRun: DRY_RUN });

  if (pathname === '/api/submit') {
    const origin = originInfo(req);
    const cors = origin.headers;
    if (req.method === 'OPTIONS') {
      return send(res, 204, '', Object.assign({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }, cors));
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Use POST.' }, cors);
    if (!origin.ok) return json(res, 403, { ok: false, error: 'This site is not allowed to send messages through this server.' });
    if (!/application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: 'Send JSON.' }, cors);

    const ip = clientIp(req);
    let raw;
    try { raw = await readBody(req); } catch (e) {
      if (!badLimit(ip)) return json(res, 429, { ok: false, error: 'Too many attempts. Please try again in a few minutes.' }, Object.assign({ Connection: 'close' }, cors));
      return json(res, 413, { ok: false, error: 'That message is too long.' }, Object.assign({ Connection: 'close' }, cors));
    }
    let payload;
    try { payload = JSON.parse(raw); } catch (e) { payload = null; }
    if (!payload || typeof payload !== 'object') {
      if (!badLimit(ip)) return json(res, 429, { ok: false, error: 'Too many attempts. Please try again in a few minutes.' }, cors);
      return json(res, 400, { ok: false, error: 'That request could not be read.' }, cors);
    }

    const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
    // Honeypot: real people never fill this hidden field. Pretend success and drop it.
    if (clean(fields.website, 200)) return json(res, 200, { ok: true }, cors);

    const { values, def, error } = validate(String(payload.form || ''), fields);
    if (error) {
      if (!badLimit(ip)) return json(res, 429, { ok: false, error: 'Too many attempts. Please try again in a few minutes.' }, cors);
      return json(res, 400, { ok: false, error }, cors);
    }
    if (!allowed(ip)) return json(res, 429, { ok: false, error: 'Too many messages. Please try again in a few minutes.' }, cors);

    try {
      await sendMail(buildMessage(values, def), values);
      return json(res, 200, DRY_RUN ? { ok: true, dryRun: true } : { ok: true }, cors);
    } catch (e) {
      console.error('Mail error:', e && e.message);
      return json(res, 502, { ok: false, error: 'We could not send your message right now. Please try again in a little while.' }, cors);
    }
  }

  if (!SERVE_SITE) return send(res, 404, 'Not found');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  return serveStatic(req, res);
});

server.listen(PORT, async () => {
  console.log('Club form server on port ' + PORT + (SERVE_SITE ? ' (also serving the site)' : ' (forms only)') +
    (DRY_RUN ? ' [TEST MODE: emails are printed, not sent]' : ' [emails go to ' + MAIL_TO + ']'));
  console.log(ALLOWED_ORIGINS.length ? 'Accepting forms from: ' + ALLOWED_ORIGINS.join(', ') : 'Accepting forms from this server only (set ALLOWED_ORIGINS to allow a GitHub Pages site)');
  if (!DRY_RUN) {
    try { await getTransporter().verify(); console.log('Email connection verified.'); }
    catch (e) { console.error('Could not connect to the email server: ' + (e && e.message) + '\nForms will fail until this is fixed. Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS.'); }
  }
});
