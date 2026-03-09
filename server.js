const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcrypt');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ORDER_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const USER_LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const USER_LOGIN_MAX_ATTEMPTS = 10;
const USER_LOGIN_BLOCK_MS = 10 * 60 * 1000;

const ADMIN_SESSION_COOKIE = 'waten_admin_session';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin').trim() || 'admin';

const SITE_HISTORY_LIMIT = 20;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const adminSessions = new Map();
const loginAttempts = new Map();
const userLoginAttempts = new Map();

ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);

const initFiles = ['products.json', 'site.json', 'orders.json', 'config.json', 'users.json'];
initFiles.forEach((file) => {
  const src = path.join(__dirname, file);
  const dest = path.join(DATA_DIR, file);
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
});

if (!fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
  writeJson(path.join(DATA_DIR, 'users.json'), []);
}
if (!fs.existsSync(path.join(DATA_DIR, 'products.json'))) {
  writeJson(path.join(DATA_DIR, 'products.json'), { products: [] });
}
if (!fs.existsSync(path.join(DATA_DIR, 'orders.json'))) {
  writeJson(path.join(DATA_DIR, 'orders.json'), { orders: [] });
}
if (!fs.existsSync(path.join(DATA_DIR, 'config.json'))) {
  writeJson(path.join(DATA_DIR, 'config.json'), {
    adminPasswordHash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10),
    fallbackImage: ''
  });
}
saveSiteState(getSiteState());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error('Unsupported file type. Use JPG, PNG, WEBP, AVIF, or GIF.'));
    }
    cb(null, true);
  }
});

app.use((req, res, next) => {
  const requestId = crypto.randomBytes(6).toString('hex');
  const startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    if (process.env.REQUEST_LOGS === 'false') return;
    const durationMs = Date.now() - startedAt;
    const ip = getClientIp(req);
    console.log(
      `[${nowIso()}] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${durationMs}ms ip=${ip} reqId=${requestId}`
    );
  });
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' https: data: blob:",
      "connect-src 'self' https:",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  if (shouldUseSecureCookies()) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  pruneExpiredSessions();
  pruneLoginAttempts();
  pruneUserLoginAttempts();
  attachAdminSession(req, res);
  next();
});
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function toSafeString(value, maxLen = 300) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeText(value, maxLen = 180) {
  return toSafeString(value, maxLen).replace(/[<>]/g, '');
}

function sanitizeLongText(value, maxLen = 2000) {
  return toSafeString(value, maxLen).replace(/[<>]/g, '');
}

function sanitizeEmail(value) {
  const email = toSafeString(value, 180).toLowerCase();
  if (!email) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  return '';
}

function sanitizePhone(value) {
  return toSafeString(value, 32).replace(/[^0-9+\-\s()]/g, '');
}

function sanitizeToken(value, maxLen = 60) {
  return toSafeString(value, maxLen).replace(/[^A-Za-z0-9_\-.]/g, '');
}

function sanitizeUrlOrPath(value) {
  const raw = toSafeString(value, 600);
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  const isRelative =
    normalized.startsWith('#') ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    /^uploads\//i.test(normalized) ||
    /^images\//i.test(normalized) ||
    /^[A-Za-z0-9_\-./]+\.(png|jpg|jpeg|webp|gif|avif)$/i.test(normalized);
  if (isRelative && !normalized.includes('..')) return normalized;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch (_) {}
  return '';
}

function sanitizeNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function sanitizeNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function sanitizeSku(value) {
  return toSafeString(value, 48).toUpperCase().replace(/[^A-Z0-9_\-.]/g, '');
}

function makeSkuFromName(name) {
  const base = sanitizeText(name, 60)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (!base) return '';
  return base;
}

function parseVariantList(value) {
  const list = Array.isArray(value) ? value : toSafeString(value, 300).split(',');
  const seen = new Set();
  return list
    .map((item) => sanitizeText(item, 32))
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function normalizeProduct(input = {}, existing = {}) {
  const source = { ...existing, ...input };
  const createdAt = normalizeDate(existing.createdAt || source.createdAt) || nowIso();
  const updatedAt = normalizeDate(source.updatedAt) || nowIso();

  return {
    id: toSafeString(existing.id || source.id || `PRD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, 80),
    name: sanitizeText(source.name || 'Untitled Product', 120) || 'Untitled Product',
    price: sanitizeNonNegativeNumber(source.price, 0),
    image: sanitizeUrlOrPath(source.image),
    category: sanitizeText(source.category, 40).toLowerCase(),
    sku: sanitizeSku(source.sku),
    stock: sanitizeNonNegativeInt(source.stock, source.stock == null ? 25 : 0),
    lowStockThreshold: sanitizeNonNegativeInt(source.lowStockThreshold, source.lowStockThreshold == null ? 5 : 0),
    variants: {
      sizes: parseVariantList(source?.variants?.sizes || source.sizes || ''),
      colors: parseVariantList(source?.variants?.colors || source.colors || '')
    },
    createdAt,
    updatedAt
  };
}

function normalizeOrder(payload = {}) {
  const quantity = Math.min(999, Math.max(1, Number.parseInt(payload.quantity, 10) || 1));
  const orderDate = normalizeDate(payload.orderDate) || nowIso();
  const status = ORDER_STATUSES.includes(toSafeString(payload.status, 40).toLowerCase())
    ? toSafeString(payload.status, 40).toLowerCase()
    : 'pending';

  const product = {
    id: payload?.product?.id != null ? String(payload.product.id) : '',
    name: sanitizeText(payload?.product?.name || 'Unknown product', 120),
    price: sanitizeNonNegativeNumber(payload?.product?.price, 0),
    image: sanitizeUrlOrPath(payload?.product?.image),
    sku: sanitizeSku(payload?.product?.sku)
  };

  const totalCandidate = Number(payload.totalPrice ?? payload.total);
  const totalPrice = Number.isFinite(totalCandidate) ? Math.max(0, totalCandidate) : product.price * quantity;

  return {
    orderId: toSafeString(payload.orderId, 80) || `ORD-${Date.now()}`,
    product,
    customer: {
      name: sanitizeText(payload?.customer?.name, 80),
      phone: sanitizePhone(payload?.customer?.phone),
      email: sanitizeEmail(payload?.customer?.email),
      address: sanitizeText(payload?.customer?.address, 160),
      city: sanitizeText(payload?.customer?.city, 80),
      postalCode: sanitizeText(payload?.customer?.postalCode, 20)
    },
    quantity,
    notes: sanitizeLongText(payload.notes, 600),
    totalPrice,
    orderDate,
    status
  };
}

function normalizeDate(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toISOString();
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      const key = part.slice(0, index);
      const val = part.slice(index + 1);
      try {
        acc[key] = decodeURIComponent(val);
      } catch (_) {
        acc[key] = val;
      }
      return acc;
    }, {});
}

function appendSetCookie(res, cookieValue) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieValue]);
    return;
  }
  res.setHeader('Set-Cookie', [existing, cookieValue]);
}

function shouldUseSecureCookies() {
  if (process.env.SESSION_COOKIE_SECURE === 'true') return true;
  if (process.env.SESSION_COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function setAdminSessionCookie(res, sessionId) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`
  ];
  if (shouldUseSecureCookies()) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

function clearAdminSessionCookie(res) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (shouldUseSecureCookies()) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) adminSessions.delete(sessionId);
  }
}

function attachAdminSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[ADMIN_SESSION_COOKIE];
  if (!sessionId) return;
  const session = adminSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(sessionId);
    return;
  }

  session.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  session.lastSeenAt = nowIso();
  adminSessions.set(sessionId, session);

  req.adminSessionId = sessionId;
  req.adminSession = session;
  setAdminSessionCookie(res, sessionId);
}

function createAdminSession(req, res) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  adminSessions.set(sessionId, {
    isAdmin: true,
    ip: getClientIp(req),
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  });
  setAdminSessionCookie(res, sessionId);
  return sessionId;
}

function destroyAdminSession(req, res) {
  if (req.adminSessionId) adminSessions.delete(req.adminSessionId);
  clearAdminSessionCookie(res);
}

function isAuthenticated(req) {
  return Boolean(req.adminSession && req.adminSession.isAdmin);
}

function requireAdmin(req, res, next) {
  if (!isAuthenticated(req)) {
    writeAudit('admin_unauthorized', req, { method: req.method, path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function pruneLoginAttempts() {
  const now = Date.now();
  for (const [ip, data] of loginAttempts.entries()) {
    if (data.blockedUntil && data.blockedUntil <= now && data.count === 0) {
      loginAttempts.delete(ip);
      continue;
    }
    if (data.windowStart + LOGIN_ATTEMPT_WINDOW_MS < now && (!data.blockedUntil || data.blockedUntil <= now)) {
      loginAttempts.delete(ip);
    }
  }
}

function getLoginRateState(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return { blocked: false, retryAfterMs: 0 };

  if (entry.blockedUntil && entry.blockedUntil > now) {
    return { blocked: true, retryAfterMs: entry.blockedUntil - now };
  }
  if (entry.blockedUntil && entry.blockedUntil <= now) {
    loginAttempts.delete(ip);
  }
  return { blocked: false, retryAfterMs: 0 };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.windowStart + LOGIN_ATTEMPT_WINDOW_MS < now) {
    loginAttempts.set(ip, { count: 1, windowStart: now, blockedUntil: 0 });
    return;
  }

  current.count += 1;
  if (current.count >= LOGIN_MAX_ATTEMPTS) {
    current.blockedUntil = now + LOGIN_BLOCK_MS;
    current.count = 0;
  }
  loginAttempts.set(ip, current);
}

function clearLoginState(ip) {
  loginAttempts.delete(ip);
}

function pruneUserLoginAttempts() {
  const now = Date.now();
  for (const [ip, data] of userLoginAttempts.entries()) {
    if (data.blockedUntil && data.blockedUntil <= now && data.count === 0) {
      userLoginAttempts.delete(ip);
      continue;
    }
    if (data.windowStart + USER_LOGIN_ATTEMPT_WINDOW_MS < now && (!data.blockedUntil || data.blockedUntil <= now)) {
      userLoginAttempts.delete(ip);
    }
  }
}

function getUserLoginRateState(ip) {
  const now = Date.now();
  const entry = userLoginAttempts.get(ip);
  if (!entry) return { blocked: false, retryAfterMs: 0 };

  if (entry.blockedUntil && entry.blockedUntil > now) {
    return { blocked: true, retryAfterMs: entry.blockedUntil - now };
  }
  if (entry.blockedUntil && entry.blockedUntil <= now) {
    userLoginAttempts.delete(ip);
  }
  return { blocked: false, retryAfterMs: 0 };
}

function recordFailedUserLogin(ip) {
  const now = Date.now();
  const current = userLoginAttempts.get(ip);
  if (!current || current.windowStart + USER_LOGIN_ATTEMPT_WINDOW_MS < now) {
    userLoginAttempts.set(ip, { count: 1, windowStart: now, blockedUntil: 0 });
    return;
  }

  current.count += 1;
  if (current.count >= USER_LOGIN_MAX_ATTEMPTS) {
    current.blockedUntil = now + USER_LOGIN_BLOCK_MS;
    current.count = 0;
  }
  userLoginAttempts.set(ip, current);
}

function clearUserLoginState(ip) {
  userLoginAttempts.delete(ip);
}

function secureEquals(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(first, second);
}

async function verifyAdminPassword(password, config) {
  const candidate = toSafeString(password, 120);
  if (!candidate) return { ok: false, migrated: false };

  if (config.adminPasswordHash && isBcryptHash(config.adminPasswordHash)) {
    try {
      return { ok: await bcrypt.compare(candidate, config.adminPasswordHash), migrated: false };
    } catch (_) {
      return { ok: false, migrated: false };
    }
  }

  const legacyPassword = toSafeString(config.adminPassword, 120);
  if (!legacyPassword) return { ok: false, migrated: false };

  const ok = secureEquals(candidate, legacyPassword);
  if (!ok) return { ok: false, migrated: false };

  saveConfig({
    ...config,
    adminPasswordHash: bcrypt.hashSync(candidate, 10),
    adminPassword: ''
  });
  return { ok: true, migrated: true };
}

function writeAudit(event, req, details = {}) {
  const entry = {
    at: nowIso(),
    event,
    ip: getClientIp(req),
    method: req.method,
    path: req.path,
    userAgent: toSafeString(req.headers['user-agent'], 240),
    details
  };
  fs.appendFile(path.join(DATA_DIR, 'audit.log'), JSON.stringify(entry) + '\n', () => {});
}

function getProductsPath() {
  return path.join(DATA_DIR, 'products.json');
}

function getSitePath() {
  return path.join(DATA_DIR, 'site.json');
}

function getOrdersPath() {
  return path.join(DATA_DIR, 'orders.json');
}

function getUsersPath() {
  return path.join(DATA_DIR, 'users.json');
}

function getConfigPath() {
  return path.join(DATA_DIR, 'config.json');
}

function getProducts() {
  const parsed = readJson(getProductsPath(), { products: [] });
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.products) ? parsed.products : [];
  return list.map((product) => normalizeProduct(product));
}

function saveProducts(products) {
  writeJson(getProductsPath(), { products: products.map((product) => normalizeProduct(product, product)) });
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value || ''));
}

function getConfig() {
  const config = readJson(getConfigPath(), { adminPasswordHash: '', adminPassword: '', fallbackImage: '' });
  const envHash = toSafeString(process.env.ADMIN_PASSWORD_HASH, 200);
  const storedHash = toSafeString(config.adminPasswordHash, 200);
  const legacyPassword = toSafeString(config.adminPassword, 120);

  return {
    adminPasswordHash: isBcryptHash(envHash) ? envHash : isBcryptHash(storedHash) ? storedHash : '',
    adminPassword: legacyPassword,
    fallbackImage: sanitizeUrlOrPath(config.fallbackImage)
  };
}

function saveConfig(config) {
  const safeHash = toSafeString(config.adminPasswordHash, 200);
  const payload = {
    fallbackImage: sanitizeUrlOrPath(config.fallbackImage)
  };

  if (isBcryptHash(safeHash)) {
    payload.adminPasswordHash = safeHash;
  } else if (config.adminPassword != null) {
    payload.adminPassword = toSafeString(config.adminPassword, 120) || DEFAULT_ADMIN_PASSWORD;
  } else {
    payload.adminPasswordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10);
  }

  writeJson(getConfigPath(), payload);
}

function getUsers() {
  const parsed = readJson(getUsersPath(), []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveUsers(users) {
  writeJson(getUsersPath(), users);
}

function getOrders() {
  const parsed = readJson(getOrdersPath(), { orders: [] });
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.orders) ? parsed.orders : [];
  return list.map((order) => normalizeOrder(order));
}

function saveOrders(orders) {
  writeJson(getOrdersPath(), { orders: orders.map((order) => normalizeOrder(order)) });
}

function sanitizeNavigationLinks(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => ({
      label: sanitizeText(item?.label, 60),
      href: sanitizeUrlOrPath(item?.href) || '#'
    }))
    .filter((item) => item.label)
    .slice(0, 20);
}

function sanitizeSiteContent(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const content = {};

  if (source.meta || source.metaTitle || source.metaDescription || source.metaKeywords) {
    const metaSource = source.meta || {};
    content.meta = {
      title: sanitizeText(metaSource.title || source.metaTitle, 140),
      description: sanitizeLongText(metaSource.description || source.metaDescription, 320),
      keywords: sanitizeText(metaSource.keywords || source.metaKeywords, 260)
    };
  }

  if (source.header || source.navigation) {
    const headerSource = source.header || {};
    content.header = {
      logoText: sanitizeText(headerSource.logoText, 40),
      navLinks: sanitizeNavigationLinks(headerSource.navLinks || source.navigation || [])
    };
  }

  if (source.hero) {
    content.hero = {
      title: sanitizeText(source.hero.title, 120),
      tagline: sanitizeText(source.hero.tagline, 220),
      ctaText: sanitizeText(source.hero.ctaText, 80),
      backgroundImage: sanitizeUrlOrPath(source.hero.backgroundImage)
    };
  }

  if (source.collection) {
    content.collection = {
      heading: sanitizeText(source.collection.heading, 120),
      subtitle: sanitizeText(source.collection.subtitle, 220),
      backgroundImage: sanitizeUrlOrPath(source.collection.backgroundImage)
    };
  }

  if (source.invest) {
    content.invest = {
      heading: sanitizeText(source.invest.heading, 120),
      body: sanitizeLongText(source.invest.body, 1200),
      ctaText: sanitizeText(source.invest.ctaText, 120)
    };
  }

  if (source.footer) {
    content.footer = {
      logoText: sanitizeText(source.footer.logoText, 40),
      tagline: sanitizeText(source.footer.tagline, 220),
      copyright: sanitizeText(source.footer.copyright, 180),
      backgroundImage: sanitizeUrlOrPath(source.footer.backgroundImage),
      links: sanitizeNavigationLinks(source.footer.links || [])
    };
  }

  if (source.social) {
    content.social = {
      whatsapp: sanitizeUrlOrPath(source.social.whatsapp),
      instagram: sanitizeUrlOrPath(source.social.instagram),
      tiktok: sanitizeUrlOrPath(source.social.tiktok),
      twitter: sanitizeUrlOrPath(source.social.twitter),
      youtube: sanitizeUrlOrPath(source.social.youtube),
      facebook: sanitizeUrlOrPath(source.social.facebook),
      email: sanitizeEmail(source.social.email)
    };
  }

  if (source.contact) {
    content.contact = {
      email: sanitizeEmail(source.contact.email),
      phone: sanitizePhone(source.contact.phone),
      address: sanitizeText(source.contact.address, 180),
      city: sanitizeText(source.contact.city, 80)
    };
  }

  if (source.analytics) {
    content.analytics = {
      googleAnalytics: sanitizeToken(source.analytics.googleAnalytics, 40),
      facebookPixel: sanitizeToken(source.analytics.facebookPixel, 40)
    };
  }

  return content;
}

function normalizeSiteVersion(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    versionId: toSafeString(value.versionId, 80) || `VER-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    createdAt: normalizeDate(value.createdAt) || nowIso(),
    note: sanitizeText(value.note, 160),
    content: sanitizeSiteContent(value.content || {})
  };
}

function normalizeSiteState(raw) {
  if (raw && typeof raw === 'object' && raw.published && raw.draft) {
    const history = Array.isArray(raw.history)
      ? raw.history.map((entry) => normalizeSiteVersion(entry)).filter(Boolean).slice(0, SITE_HISTORY_LIMIT)
      : [];
    return {
      published: sanitizeSiteContent(raw.published),
      draft: sanitizeSiteContent(raw.draft),
      history,
      lastPublishedAt: normalizeDate(raw.lastPublishedAt) || '',
      lastUpdatedAt: normalizeDate(raw.lastUpdatedAt) || nowIso()
    };
  }

  const legacyPublished = sanitizeSiteContent(raw && typeof raw === 'object' ? raw : {});
  return {
    published: legacyPublished,
    draft: clone(legacyPublished),
    history: [],
    lastPublishedAt: '',
    lastUpdatedAt: nowIso()
  };
}

function getSiteState() {
  return normalizeSiteState(readJson(getSitePath(), {}));
}

function saveSiteState(state) {
  writeJson(getSitePath(), normalizeSiteState(state));
}

function deepMerge(base, patch) {
  const baseObj = base && typeof base === 'object' ? base : {};
  const patchObj = patch && typeof patch === 'object' ? patch : {};
  const merged = { ...baseObj };

  Object.keys(patchObj).forEach((key) => {
    const patchValue = patchObj[key];
    const baseValue = baseObj[key];

    if (Array.isArray(patchValue)) {
      merged[key] = patchValue;
      return;
    }

    if (patchValue && typeof patchValue === 'object') {
      merged[key] = deepMerge(baseValue, patchValue);
      return;
    }

    merged[key] = patchValue;
  });

  return merged;
}

function buildSiteVersion(content, note = '') {
  return {
    versionId: `VER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    createdAt: nowIso(),
    note: sanitizeText(note, 160),
    content: sanitizeSiteContent(content || {})
  };
}

function validateProductPayload(payload, products, existingProduct = null) {
  const normalized = normalizeProduct(payload, existingProduct || {});
  normalized.updatedAt = nowIso();

  if (!normalized.name) {
    throw new Error('Product name is required');
  }
  if (!Number.isFinite(normalized.price) || normalized.price < 0) {
    throw new Error('Price must be a non-negative number');
  }
  if (!normalized.sku) {
    const baseSku = makeSkuFromName(normalized.name) || `SKU-${Date.now()}`;
    normalized.sku = baseSku;
  }
  const duplicate = products.find(
    (product) =>
      product.id !== normalized.id &&
      product.sku &&
      normalized.sku &&
      product.sku.toUpperCase() === normalized.sku.toUpperCase()
  );
  if (duplicate) {
    throw new Error(`SKU "${normalized.sku}" already exists`);
  }
  return normalized;
}

function isLowStock(product) {
  return sanitizeNonNegativeInt(product.stock, 0) <= sanitizeNonNegativeInt(product.lowStockThreshold, 0);
}

function applyOrderFilters(orders, query = {}) {
  let filtered = [...orders];

  const status = toSafeString(query.status, 40).toLowerCase();
  if (status && ORDER_STATUSES.includes(status)) {
    filtered = filtered.filter((order) => order.status === status);
  }

  const search = toSafeString(query.q, 120).toLowerCase();
  if (search) {
    filtered = filtered.filter((order) => {
      const customer = order.customer || {};
      const product = order.product || {};
      const combined = [order.orderId, customer.name, customer.phone, customer.email, product.name]
        .map((value) => toSafeString(value, 160).toLowerCase())
        .join(' ');
      return combined.includes(search);
    });
  }

  const from = normalizeDate(query.from);
  if (from) {
    const fromTime = Date.parse(from);
    filtered = filtered.filter((order) => Date.parse(order.orderDate || '') >= fromTime);
  }

  const to = normalizeDate(query.to);
  if (to) {
    const toTime = Date.parse(to);
    filtered = filtered.filter((order) => Date.parse(order.orderDate || '') <= toTime);
  }

  const limit = Math.max(0, Number.parseInt(query.limit, 10) || 0);
  filtered.sort((a, b) => Date.parse(b.orderDate || 0) - Date.parse(a.orderDate || 0));

  if (limit > 0) return filtered.slice(0, limit);
  return filtered;
}

function csvEscape(value) {
  const safe = String(value ?? '');
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function ordersToCsv(orders) {
  const headers = [
    'Order ID',
    'Order Date',
    'Status',
    'Customer Name',
    'Phone',
    'Email',
    'Address',
    'City',
    'Postal Code',
    'Product ID',
    'Product Name',
    'SKU',
    'Quantity',
    'Unit Price',
    'Total Price'
  ];

  const rows = orders.map((order) => {
    const customer = order.customer || {};
    const product = order.product || {};
    return [
      order.orderId,
      order.orderDate,
      order.status,
      customer.name || '',
      customer.phone || '',
      customer.email || '',
      customer.address || '',
      customer.city || '',
      customer.postalCode || '',
      product.id || '',
      product.name || '',
      product.sku || '',
      order.quantity || 1,
      Number(product.price) || 0,
      Number(order.totalPrice) || 0
    ]
      .map(csvEscape)
      .join(',');
  });

  return [headers.map(csvEscape).join(','), ...rows].join('\n');
}

async function postWebhook(url, payload) {
  if (!url || typeof fetch !== 'function') return { skipped: true };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function notifyOrderEvent(eventType, order, extra = {}) {
  const compactOrder = {
    orderId: order.orderId,
    status: order.status,
    orderDate: order.orderDate,
    totalPrice: order.totalPrice,
    quantity: order.quantity,
    customer: order.customer,
    product: order.product
  };

  const message =
    eventType === 'new_order'
      ? `New order ${order.orderId} from ${order.customer?.name || 'Unknown'} (${order.totalPrice} TND)`
      : `Order ${order.orderId} changed status to ${order.status}`;

  const payload = {
    event: eventType,
    message,
    order: compactOrder,
    extra,
    sentAt: nowIso()
  };

  const targets = [
    { channel: 'email', url: process.env.EMAIL_ALERT_WEBHOOK_URL || '', to: process.env.ALERT_EMAIL_TO || '' },
    { channel: 'whatsapp', url: process.env.WHATSAPP_ALERT_WEBHOOK_URL || '', to: process.env.WHATSAPP_ALERT_TO || '' },
    { channel: 'generic', url: process.env.NOTIFY_WEBHOOK_URL || '', to: '' }
  ].filter((target) => target.url);

  if (!targets.length) return;

  const results = await Promise.allSettled(
    targets.map((target) =>
      postWebhook(target.url, { ...payload, channel: target.channel, to: target.to, source: 'waten-server' })
    )
  );

  const failed = results.filter((result) => result.status === 'fulfilled' && !result.value.ok);
  if (failed.length) {
    console.error('Some notification webhooks failed', failed.map((f) => f.value));
  }
}

function saveSiteDraft(req, res) {
  try {
    const patch = sanitizeSiteContent(req.body || {});
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No valid content fields to save' });
    }

    const state = getSiteState();
    state.draft = sanitizeSiteContent(deepMerge(state.draft || {}, patch));
    state.lastUpdatedAt = nowIso();
    saveSiteState(state);
    writeAudit('site_draft_saved', req, { sections: Object.keys(patch) });

    res.json({
      draft: state.draft,
      lastPublishedAt: state.lastPublishedAt || '',
      versions: (state.history || []).map((entry) => ({
        versionId: entry.versionId,
        createdAt: entry.createdAt,
        note: entry.note
      }))
    });
  } catch (_) {
    res.status(500).json({ error: 'Failed to save site draft' });
  }
}

// API: Login with rate limiting and server session
app.post('/api/login', async (req, res) => {
  const ip = getClientIp(req);
  const rateState = getLoginRateState(ip);
  if (rateState.blocked) {
    const retryAfterSeconds = Math.ceil(rateState.retryAfterMs / 1000);
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.', retryAfter: retryAfterSeconds });
  }

  const password = req.body?.password;
  const config = getConfig();
  const verification = await verifyAdminPassword(password, config);
  const isValid = verification.ok;

  if (!isValid) {
    recordFailedLogin(ip);
    writeAudit('admin_login_failed', req);
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }

  clearLoginState(ip);
  createAdminSession(req, res);
  writeAudit('admin_login_success', req);
  if (verification.migrated) {
    writeAudit('admin_password_migrated', req);
  }
  res.json({ ok: true });
});

// API: Check admin session
app.get('/api/auth/me', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  res.json({ ok: true });
});

// API: Logout admin session
app.post('/api/logout', (req, res) => {
  destroyAdminSession(req, res);
  writeAudit('admin_logout', req);
  res.json({ ok: true });
});

// API: Get products (public)
app.get('/api/products', (req, res) => {
  try {
    const products = getProducts().map((product) => ({
      ...product,
      lowStock: isLowStock(product)
    }));
    res.json(products);
  } catch (_) {
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// API: Get low-stock products (admin)
app.get('/api/products/alerts', requireAdmin, (req, res) => {
  try {
    const lowStock = getProducts().filter((product) => isLowStock(product));
    res.json(lowStock);
  } catch (_) {
    res.status(500).json({ error: 'Failed to load inventory alerts' });
  }
});

// API: Add product (admin)
app.post('/api/products', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const newProduct = validateProductPayload(
      { ...req.body, id: `PRD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}` },
      products
    );

    products.push(newProduct);
    saveProducts(products);
    writeAudit('product_created', req, { productId: newProduct.id, sku: newProduct.sku });
    res.status(201).json({ ...newProduct, lowStock: isLowStock(newProduct) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to add product' });
  }
});

// API: Update product (admin)
app.put('/api/products/:id', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const index = products.findIndex((product) => String(product.id) === String(req.params.id));
    if (index === -1) return res.status(404).json({ error: 'Product not found' });

    const updatedProduct = validateProductPayload(
      { ...products[index], ...req.body, id: products[index].id },
      products,
      products[index]
    );
    products[index] = updatedProduct;
    saveProducts(products);
    writeAudit('product_updated', req, { productId: updatedProduct.id, sku: updatedProduct.sku });
    res.json({ ...updatedProduct, lowStock: isLowStock(updatedProduct) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update product' });
  }
});

// API: Delete product (admin)
app.delete('/api/products/:id', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const existing = products.find((product) => String(product.id) === String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const nextProducts = products.filter((product) => String(product.id) !== String(req.params.id));
    saveProducts(nextProducts);
    writeAudit('product_deleted', req, { productId: existing.id, sku: existing.sku });
    res.json({ ok: true });
  } catch (_) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// API: Upload image (admin, type+size validation)
app.post('/api/upload', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `File too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)` });
    }
    return res.status(400).json({ error: error.message || 'Upload failed' });
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file selected' });

  const mimeToExt = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif'
  };
  const ext = mimeToExt[req.file.mimetype] || 'bin';
  const filename = `img-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;

  fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
  writeAudit('media_uploaded', req, { filename, mime: req.file.mimetype, bytes: req.file.size });
  res.json({ path: `uploads/${filename}` });
});

function getUserFromAuthorization(req) {
  const token = toSafeString(req.headers['authorization']?.replace(/^Bearer\s+/i, ''), 180);
  if (!token) return null;

  const users = getUsers();
  return users.find((item) => item.token === token) || null;
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt
  };
}

// API: User Registration
app.post('/api/users/register', async (req, res) => {
  try {
    const name = sanitizeText(req.body?.name, 80);
    const email = sanitizeEmail(req.body?.email);
    const password = toSafeString(req.body?.password, 160);
    const phone = sanitizePhone(req.body?.phone);

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const users = getUsers();
    if (users.find((user) => sanitizeEmail(user.email) === email)) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(24).toString('hex');

    const newUser = {
      id: `USR-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      name,
      email,
      password: hashedPassword,
      phone,
      token,
      createdAt: nowIso()
    };

    users.push(newUser);
    saveUsers(users);

    res.status(201).json({
      token,
      user: toPublicUser(newUser)
    });
  } catch (_) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// API: User Login
app.post('/api/users/login', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const rateState = getUserLoginRateState(ip);
    if (rateState.blocked) {
      const retryAfterSeconds = Math.ceil(rateState.retryAfterMs / 1000);
      return res.status(429).json({ error: 'Too many attempts. Try again later.', retryAfter: retryAfterSeconds });
    }

    const email = sanitizeEmail(req.body?.email);
    const password = toSafeString(req.body?.password, 160);
    const users = getUsers();
    const userIndex = users.findIndex((item) => sanitizeEmail(item.email) === email);
    const user = userIndex >= 0 ? users[userIndex] : null;

    if (!user || !(await bcrypt.compare(password, user.password))) {
      recordFailedUserLogin(ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearUserLoginState(ip);
    const token = crypto.randomBytes(24).toString('hex');
    users[userIndex] = { ...user, token };
    saveUsers(users);

    res.json({
      token,
      user: toPublicUser(users[userIndex])
    });
  } catch (_) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// API: Get Current User
app.get('/api/users/me', (req, res) => {
  try {
    const user = getUserFromAuthorization(req);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    res.json({ user: toPublicUser(user) });
  } catch (_) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// API: Get current user orders
app.get('/api/users/orders', (req, res) => {
  try {
    const user = getUserFromAuthorization(req);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const userEmail = sanitizeEmail(user.email);
    const userOrders = getOrders()
      .filter((order) => sanitizeEmail(order?.customer?.email) === userEmail)
      .sort((a, b) => Date.parse(b.orderDate || 0) - Date.parse(a.orderDate || 0));

    res.json({ orders: userOrders });
  } catch (_) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// API: Create order (public)
app.post('/api/orders', (req, res) => {
  try {
    const newOrder = normalizeOrder(req.body || {});
    if (!newOrder.customer.name || !newOrder.customer.phone || !newOrder.customer.address || !newOrder.customer.city) {
      return res.status(400).json({ error: 'Missing required customer information' });
    }

    const orders = getOrders();
    if (orders.some((order) => String(order.orderId) === String(newOrder.orderId))) {
      newOrder.orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }

    const products = getProducts();
    const productIndex = products.findIndex((product) => String(product.id) === String(newOrder.product.id));
    if (productIndex >= 0) {
      const product = products[productIndex];
      if (product.stock < newOrder.quantity) {
        return res.status(409).json({ error: `Insufficient stock for ${product.name}. Available: ${product.stock}` });
      }
      products[productIndex] = {
        ...product,
        stock: Math.max(0, product.stock - newOrder.quantity),
        updatedAt: nowIso()
      };
      newOrder.product = {
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        sku: product.sku
      };
      newOrder.totalPrice = product.price * newOrder.quantity;
      saveProducts(products);
    }

    orders.push(newOrder);
    saveOrders(orders);
    notifyOrderEvent('new_order', newOrder).catch(() => {});
    res.status(201).json({ ok: true, order: newOrder });
  } catch (_) {
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// API: Get orders (admin, with filters)
app.get('/api/orders', requireAdmin, (req, res) => {
  try {
    const orders = getOrders();
    const filtered = applyOrderFilters(orders, req.query || {});
    res.json(filtered);
  } catch (_) {
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// API: Export orders CSV (admin, with filters)
app.get('/api/orders/export.csv', requireAdmin, (req, res) => {
  try {
    const orders = applyOrderFilters(getOrders(), req.query || {});
    const csv = ordersToCsv(orders);
    const fileDate = nowIso().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="waten-orders-${fileDate}.csv"`);
    res.send(csv);
  } catch (_) {
    res.status(500).json({ error: 'Failed to export orders' });
  }
});

// API: Update order status (admin)
app.put('/api/orders/:orderId/status', requireAdmin, (req, res) => {
  try {
    const status = toSafeString(req.body?.status, 40).toLowerCase();
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use: ${ORDER_STATUSES.join(', ')}` });
    }

    const orderId = String(req.params.orderId);
    const orders = getOrders();
    const index = orders.findIndex((order) => String(order.orderId) === orderId);
    if (index === -1) return res.status(404).json({ error: 'Order not found' });

    const previousStatus = orders[index].status;
    orders[index] = { ...orders[index], status };
    saveOrders(orders);
    writeAudit('order_status_updated', req, { orderId, previousStatus, status });

    notifyOrderEvent('order_status_updated', orders[index], { previousStatus }).catch(() => {});
    res.json(orders[index]);
  } catch (_) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// API: Get published site content (public)
app.get('/api/site', (req, res) => {
  try {
    const state = getSiteState();
    res.json(state.published || {});
  } catch (_) {
    res.status(500).json({ error: 'Failed to load site content' });
  }
});

// API: Get draft + workflow metadata (admin)
app.get('/api/site/draft', requireAdmin, (req, res) => {
  try {
    const state = getSiteState();
    res.json({
      draft: state.draft || {},
      published: state.published || {},
      lastPublishedAt: state.lastPublishedAt || '',
      versions: (state.history || []).map((entry) => ({
        versionId: entry.versionId,
        createdAt: entry.createdAt,
        note: entry.note
      }))
    });
  } catch (_) {
    res.status(500).json({ error: 'Failed to load draft site content' });
  }
});

// API: Save draft patch (admin)
app.put('/api/site/draft', requireAdmin, saveSiteDraft);

// Backward compatibility: treat PUT /api/site as draft save
app.put('/api/site', requireAdmin, saveSiteDraft);

// API: Publish current draft (admin)
app.post('/api/site/publish', requireAdmin, (req, res) => {
  try {
    const state = getSiteState();
    const previousPublished = sanitizeSiteContent(state.published || {});
    const nextPublished = sanitizeSiteContent(state.draft || {});
    const note = sanitizeText(req.body?.note || 'Dashboard publish', 160);

    if (Object.keys(previousPublished).length) {
      const version = buildSiteVersion(previousPublished, note);
      state.history = [version, ...(state.history || [])].slice(0, SITE_HISTORY_LIMIT);
    }

    state.published = nextPublished;
    state.lastPublishedAt = nowIso();
    state.lastUpdatedAt = nowIso();
    saveSiteState(state);
    writeAudit('site_published', req, { note });

    res.json({
      ok: true,
      published: state.published,
      lastPublishedAt: state.lastPublishedAt,
      versions: (state.history || []).map((entry) => ({
        versionId: entry.versionId,
        createdAt: entry.createdAt,
        note: entry.note
      }))
    });
  } catch (_) {
    res.status(500).json({ error: 'Failed to publish site draft' });
  }
});

// API: Rollback published + draft to a version (admin)
app.post('/api/site/rollback', requireAdmin, (req, res) => {
  try {
    const versionId = toSafeString(req.body?.versionId, 80);
    if (!versionId) return res.status(400).json({ error: 'versionId is required' });

    const state = getSiteState();
    const target = (state.history || []).find((entry) => entry.versionId === versionId);
    if (!target) return res.status(404).json({ error: 'Version not found' });

    const backup = buildSiteVersion(state.published || {}, `Backup before rollback to ${versionId}`);
    state.history = [backup, ...(state.history || [])].slice(0, SITE_HISTORY_LIMIT);

    const restoredContent = sanitizeSiteContent(target.content || {});
    state.published = clone(restoredContent);
    state.draft = clone(restoredContent);
    state.lastPublishedAt = nowIso();
    state.lastUpdatedAt = nowIso();
    saveSiteState(state);
    writeAudit('site_rollback', req, { versionId });

    res.json({
      ok: true,
      published: state.published,
      draft: state.draft,
      lastPublishedAt: state.lastPublishedAt,
      versions: (state.history || []).map((entry) => ({
        versionId: entry.versionId,
        createdAt: entry.createdAt,
        note: entry.note
      }))
    });
  } catch (_) {
    res.status(500).json({ error: 'Failed to rollback site content' });
  }
});

// API: Update config (admin)
app.put('/api/config', requireAdmin, (req, res) => {
  try {
    const config = getConfig();
    let passwordChanged = false;

    if (req.body.adminPassword != null) {
      const nextPassword = toSafeString(req.body.adminPassword, 120);
      if (!nextPassword) return res.status(400).json({ error: 'adminPassword cannot be empty' });
      passwordChanged = true;
      config.adminPasswordHash = bcrypt.hashSync(nextPassword, 10);
      config.adminPassword = '';
    }
    if (req.body.fallbackImage != null) {
      config.fallbackImage = sanitizeUrlOrPath(req.body.fallbackImage);
    }

    saveConfig(config);
    if (passwordChanged) {
      adminSessions.clear();
      clearAdminSessionCookie(res);
      writeAudit('admin_password_changed', req);
    }

    res.json({ ok: true, requireRelogin: passwordChanged });
  } catch (_) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// API: Get config (admin, non-sensitive fields only)
app.get('/api/config', requireAdmin, (req, res) => {
  try {
    const config = getConfig();
    res.json({ fallbackImage: config.fallbackImage || '' });
  } catch (_) {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, time: nowIso() });
});

app.use((error, req, res, next) => {
  console.error(
    `[${nowIso()}] Unhandled error reqId=${req.requestId || 'n/a'} path=${req.path || ''} message=${error?.message || 'unknown'}`
  );
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/admin.html', (req, res) => res.redirect('/dashboard.html'));
app.get('/', (req, res) => res.redirect('/idex.html'));

function startServer(port = PORT, host = '0.0.0.0') {
  return app.listen(port, host, () => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
    console.log(`\n  WATEN is live at ${url}`);
    console.log(`  Site:      ${url}/idex.html`);
    console.log(`  Dashboard: ${url}/dashboard.html\n`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
