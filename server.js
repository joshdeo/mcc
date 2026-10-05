'use strict';
/*
  Mississauga Chess Club form server.
  Receives the waitlist, volunteer and contact forms and emails them to the club.
  Also serves the static site, so one process runs everything.
  Only dependency: nodemailer (loaded only when SMTP is configured).
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
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'website@localhost';
const SITE_DIR = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..', 'site'));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DRY_RUN = process.env.DRY_RUN === '1' || !process.env.SMTP_HOST;
const MAX_BODY = 20 * 1024;
const PER_IP_LIMIT = 5, PER_IP_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_LIMIT = 120, GLOBAL_WINDOW_MS = 60 * 60 * 1000;

const NIGHTS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const FORMS = {
  waitlist: {
    subject: 'Waitlist request',
    fields: {
      name: { label: 'Player name', max: 100, req: true },
      email: { label: 'Reply email', max: 200, req: true, email: true },
      group: { label: 'Group', max: 10, req: true, oneOf: ['Youth', 'Adult'] },
      age: { label: 'Age (youth only)', max: 3, digits: true },
      level: { label: 'Playing level', max: 60 },
      cfc: { label: 'CFC ID', max: 30 },
      nights: { label: 'Preferred nights', list: NIGHTS },
      notes: { label: 'Notes', max: 2000 }
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
    if (val && spec.oneOf && !spec.oneOf.includes(val)) return { error: 'Invalid choice for ' + spec.label + '.' };
    if (val && spec.digits && !/^\d{1,3}$/.test(val)) return { error: spec.label + ' must be a number.' };
    out[key] = val;
  }
  return { values: out, def };
}

function buildMessage(formKey, values, def) {
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
async function sendMail(msg, values) {
  if (DRY_RUN) {
    console.log('[dry run] would email ' + MAIL_TO + '\nSubject: ' + msg.subject + '\n' + msg.text + '\n');
    return;
  }
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
  await transporter.sendMail({
    from: { name: 'MCC website', address: MAIL_FROM },
    to: MAIL_TO,
    replyTo: { name: oneLine(values.name).replace(/["<>]/g, ''), address: values.email },
    subject: msg.subject,
    text: msg.text,
    html: msg.html
  });
}

/* ---------- rate limiting (in memory) ---------- */
// Two limits per visitor: a strict one for messages that actually get emailed, and a looser
// one for rejected attempts, so someone fixing a typo is never locked out but abuse is capped.
const BAD_LIMIT = 30;
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
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      const nf = path.join(SITE_DIR, '404.html');
      return fs.readFile(nf, (e2, data) => send(res, 404, e2 ? 'Not found' : data, { 'Content-Type': 'text/html; charset=utf-8' }));
    }
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
    const cors = ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin' } : {};
    if (req.method === 'OPTIONS') {
      return send(res, 204, '', Object.assign({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, cors));
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Use POST.' }, cors);
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGIN && origin !== ALLOWED_ORIGIN) return json(res, 403, { ok: false, error: 'Origin not allowed.' }, cors);
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
      await sendMail(buildMessage(payload.form, values, def), values);
      return json(res, 200, { ok: true }, cors);
    } catch (e) {
      console.error('Mail error:', e && e.message);
      return json(res, 502, { ok: false, error: 'We could not send your message right now.' }, cors);
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('Club site and form server on port ' + PORT + (DRY_RUN ? ' (test mode: emails are printed, not sent)' : ' (emails go to ' + MAIL_TO + ')'));
});
