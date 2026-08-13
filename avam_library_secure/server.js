const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const initialPassword = String(process.env.ADMIN_INITIAL_PASSWORD || '');
if (!fs.existsSync(path.join(DATA_DIR, 'avam.db'))) {
  if (initialPassword.length < 14 || initialPassword.length > 200) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be 14–200 characters before first launch.');
  }
}

const db = new Database(path.join(DATA_DIR, 'avam.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('Active','Suspended','Revoked')),
    mech_name TEXT NOT NULL,
    owner TEXT NOT NULL,
    faction TEXT NOT NULL DEFAULT '',
    date_issued TEXT NOT NULL,
    pvp_types TEXT NOT NULL DEFAULT '',
    combat INTEGER NOT NULL DEFAULT 0 CHECK(combat BETWEEN 0 AND 15),
    aesthetic INTEGER NOT NULL DEFAULT 0 CHECK(aesthetic BETWEEN 0 AND 10),
    technical INTEGER NOT NULL DEFAULT 0 CHECK(technical BETWEEN 0 AND 15),
    admin INTEGER NOT NULL DEFAULT 0 CHECK(admin BETWEEN 0 AND 5),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    certificate_id TEXT,
    created_at TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT ''
  );
`);

function nowIso() { return new Date().toISOString(); }

function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024
  });
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function scryptVerify(password, stored) {
  try {
    const [, saltB64, hashB64] = String(stored).split('$');
    if (!saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/',
    maxAge: 1000 * 60 * 60 * 8
  };
}

function sanitizeText(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function validateCertificate(input) {
  const id = sanitizeText(input.id, 40).toUpperCase();
  const status = sanitizeText(input.status, 20);
  const mechName = sanitizeText(input.mechName, 120);
  const owner = sanitizeText(input.owner, 120);
  const faction = sanitizeText(input.faction, 120);
  const dateIssued = sanitizeText(input.dateIssued, 10);
  const pvpTypes = sanitizeText(input.pvpTypes, 300);
  const notes = sanitizeText(input.notes, 3000);
  const scores = {
    combat: Number(input.combat),
    aesthetic: Number(input.aesthetic),
    technical: Number(input.technical),
    admin: Number(input.admin)
  };

  if (!/^AVAM-\d{4}-\d{4}$/.test(id)) throw new Error('Certificate ID must use AVAM-YYYY-NNNN format.');
  if (!['Active', 'Suspended', 'Revoked'].includes(status)) throw new Error('Invalid certificate status.');
  if (!mechName || !owner || !dateIssued) throw new Error('Mech name, owner/builder, and issue date are required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIssued)) throw new Error('Issue date is invalid.');

  const limits = { combat: 15, aesthetic: 10, technical: 15, admin: 5 };
  for (const [key, max] of Object.entries(limits)) {
    if (!Number.isInteger(scores[key]) || scores[key] < 0 || scores[key] > max) {
      throw new Error(`Invalid ${key} score.`);
    }
  }
  return { id, status, mechName, owner, faction, dateIssued, pvpTypes, notes, ...scores };
}

function publicCertificate(row) {
  return {
    id: row.id,
    status: row.status,
    mechName: row.mech_name,
    owner: row.owner,
    faction: row.faction,
    dateIssued: row.date_issued,
    pvpTypes: row.pvp_types,
    combat: row.combat,
    aesthetic: row.aesthetic,
    technical: row.technical,
    admin: row.admin,
    revokedMessage: row.status === 'Revoked'
      ? 'This certificate has been revoked and is no longer valid.'
      : null
  };
}

function adminCertificate(row) {
  return { ...publicCertificate(row), notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}

function getSession(req) {
  const raw = req.cookies?.avam_session;
  if (!raw) return null;
  const session = db.prepare(`
    SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?
  `).get(sha256(raw), Date.now());
  return session || null;
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });
  req.session = session;
  next();
}

function requireCsrf(req, res, next) {
  if (!req.session || req.get('x-csrf-token') !== req.session.csrf_token) {
    return res.status(403).json({ error: 'Invalid security token.' });
  }
  next();
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => { req.cookies = parseCookies(req.headers.cookie); next(); });
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'none'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.json({ limit: '64kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});


const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

app.use(express.static(path.join(ROOT, 'public'), {
  index: 'index.html',
  etag: true,
  maxAge: IS_PROD ? '1h' : 0
}));

// Public verification. Only public fields are returned.
app.get('/api/verify/:id', (req, res) => {
  const id = sanitizeText(req.params.id, 40).toUpperCase();
  const row = db.prepare('SELECT * FROM certificates WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Certificate ID not found.' });
  res.json({ certificate: publicCertificate(row) });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const password = String(req.body?.password || '');
  const admin = db.prepare('SELECT * FROM admins ORDER BY id LIMIT 1').get();

  if (!admin || !password || !scryptVerify(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid password.' });
  }

  const rawToken = randomToken(32);
  const csrfToken = randomToken(24);
  db.prepare(`
    INSERT INTO sessions (token_hash, csrf_token, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sha256(rawToken), csrfToken, Date.now() + 1000 * 60 * 60 * 8, nowIso());

  res.cookie('avam_session', rawToken, cookieOptions());
  res.json({ ok: true, csrfToken });
});

app.post('/api/admin/logout', adminLimiter, (req, res) => {
  const raw = req.cookies?.avam_session;
  if (raw) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(raw));
  res.clearCookie('avam_session', { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});

app.use('/api/admin', adminLimiter);

app.get('/api/admin/me', requireAuth, (req, res) => {
  res.json({ authenticated: true, csrfToken: req.session.csrf_token });
});

app.get('/api/admin/certificates', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM certificates ORDER BY date_issued DESC, id DESC').all();
  res.json({ certificates: rows.map(adminCertificate) });
});

app.post('/api/admin/certificates', requireAuth, requireCsrf, (req, res) => {
  try {
    const c = validateCertificate(req.body);
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO certificates
      (id,status,mech_name,owner,faction,date_issued,pvp_types,combat,aesthetic,technical,admin,notes,created_at,updated_at)
      VALUES (@id,@status,@mechName,@owner,@faction,@dateIssued,@pvpTypes,@combat,@aesthetic,@technical,@admin,@notes,@createdAt,@updatedAt)
    `).run({ ...c, createdAt: timestamp, updatedAt: timestamp });

    db.prepare('INSERT INTO audit_log(action,certificate_id,created_at,details) VALUES (?,?,?,?)')
      .run('create', c.id, timestamp, 'Certificate created.');
    res.status(201).json({ certificate: adminCertificate(db.prepare('SELECT * FROM certificates WHERE id=?').get(c.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Certificate ID already exists.' : err.message });
  }
});

app.put('/api/admin/certificates/:id', requireAuth, requireCsrf, (req, res) => {
  try {
    const requestedId = sanitizeText(req.params.id, 40).toUpperCase();
    const c = validateCertificate({ ...req.body, id: requestedId });
    const timestamp = nowIso();
    const result = db.prepare(`
      UPDATE certificates SET status=@status, mech_name=@mechName, owner=@owner,
      faction=@faction, date_issued=@dateIssued, pvp_types=@pvpTypes,
      combat=@combat, aesthetic=@aesthetic, technical=@technical, admin=@admin,
      notes=@notes, updated_at=@updatedAt WHERE id=@id
    `).run({ ...c, updatedAt: timestamp });

    if (!result.changes) return res.status(404).json({ error: 'Certificate not found.' });
    db.prepare('INSERT INTO audit_log(action,certificate_id,created_at,details) VALUES (?,?,?,?)')
      .run('update', c.id, timestamp, 'Certificate updated.');
    res.json({ certificate: adminCertificate(db.prepare('SELECT * FROM certificates WHERE id=?').get(c.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/certificates/:id', requireAuth, requireCsrf, (req, res) => {
  const id = sanitizeText(req.params.id, 40).toUpperCase();
  const timestamp = nowIso();
  const result = db.prepare('DELETE FROM certificates WHERE id=?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Certificate not found.' });
  db.prepare('INSERT INTO audit_log(action,certificate_id,created_at,details) VALUES (?,?,?,?)')
    .run('delete', id, timestamp, 'Certificate permanently deleted.');
  res.json({ ok: true });
});

app.post('/api/admin/change-password', requireAuth, requireCsrf, (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 14) return res.status(400).json({ error: 'New password must be at least 14 characters.' });
  if (next.length > 200) return res.status(400).json({ error: 'New password is too long.' });

  const admin = db.prepare('SELECT * FROM admins ORDER BY id LIMIT 1').get();
  if (!admin || !scryptVerify(current, admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  db.prepare('UPDATE admins SET password_hash=?, updated_at=? WHERE id=?')
    .run(scryptHash(next), nowIso(), admin.id);

  // Invalidate every session after a password change.
  db.prepare('DELETE FROM sessions').run();
  res.clearCookie('avam_session', { httpOnly: true, secure: IS_PROD, sameSite: 'strict', path: '/' });
  res.json({ ok: true, message: 'Password changed. Please sign in again.' });
});

function seed() {
  const adminExists = db.prepare('SELECT COUNT(*) AS count FROM admins').get().count > 0;
  if (!adminExists) {
    db.prepare('INSERT INTO admins(password_hash,created_at,updated_at) VALUES (?,?,?)')
      .run(scryptHash(process.env.ADMIN_INITIAL_PASSWORD), nowIso(), nowIso());
  }

  const count = db.prepare('SELECT COUNT(*) AS count FROM certificates').get().count;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO certificates
      (id,status,mech_name,owner,faction,date_issued,pvp_types,combat,aesthetic,technical,admin,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const t = nowIso();
    insert.run('AVAM-2025-0187','Revoked','Halcyon Wake','R. Dune','Ninth Foundry','2025-11-20','1v1 Duel, Arena Free-for-All',12,7,9,2,'Mechanical compliance failures documented during review.',t,t);
    insert.run('AVAM-2026-0001','Active','Iron Vesper','K. Ardent','Vanguard Alliance','2026-01-15','Squad Skirmish, Tactical Domination',14,9,12,4,'',t,t);
    insert.run('AVAM-2026-0002','Suspended','Grave Lantern','M. Solveig','','2026-02-07','1v1 Duel, Squad Skirmish',11,8,13,4,'Pending registrar review.',t,t);
  }
}
seed();

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'An internal server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`A.V.A.M. Library running on http://localhost:${PORT}`);
});
