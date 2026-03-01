const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, 'img-' + Date.now() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

app.use(express.json());
app.use(express.static(DATA_DIR));

function getProducts() {
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
  return data.products;
}

function saveProducts(products) {
  fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify({ products }, null, 2));
}

function getConfig() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8'));
}

function getSitePath() {
  return path.join(DATA_DIR, 'site.json');
}

function getOrdersPath() {
  return path.join(DATA_DIR, 'orders.json');
}

function getSite() {
  try {
    return JSON.parse(fs.readFileSync(getSitePath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveSite(data) {
  fs.writeFileSync(getSitePath(), JSON.stringify(data, null, 2));
}

function getOrders() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getOrdersPath(), 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.orders)) return parsed.orders;
    return [];
  } catch (e) {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(getOrdersPath(), JSON.stringify({ orders }, null, 2));
}

const ORDER_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

function toSafeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeOrder(payload = {}) {
  const quantity = Math.max(1, Number(payload.quantity) || 1);
  const unitPrice = Number(payload?.product?.price) || 0;
  const totalCandidate = Number(payload.totalPrice ?? payload.total);
  const totalPrice = Number.isFinite(totalCandidate) ? totalCandidate : unitPrice * quantity;
  const status = ORDER_STATUSES.includes(payload.status) ? payload.status : 'pending';
  const parsedDate = Date.parse(payload.orderDate);
  const orderDate = Number.isNaN(parsedDate) ? new Date().toISOString() : new Date(parsedDate).toISOString();

  return {
    orderId: toSafeString(payload.orderId) || `ORD-${Date.now()}`,
    product: {
      id: payload?.product?.id != null ? String(payload.product.id) : '',
      name: toSafeString(payload?.product?.name) || 'Unknown product',
      price: unitPrice,
      image: toSafeString(payload?.product?.image)
    },
    customer: {
      name: toSafeString(payload?.customer?.name),
      phone: toSafeString(payload?.customer?.phone),
      email: toSafeString(payload?.customer?.email),
      address: toSafeString(payload?.customer?.address),
      city: toSafeString(payload?.customer?.city),
      postalCode: toSafeString(payload?.customer?.postalCode)
    },
    quantity,
    notes: toSafeString(payload.notes),
    totalPrice,
    orderDate,
    status
  };
}

// Simple session check (password in body or cookie)
function isAuthenticated(req) {
  const config = getConfig();
  const pwd = req.body?.password || req.headers['x-admin-password'] || req.query?.password;
  return pwd === config.adminPassword;
}

// API: Get products (public)
app.get('/api/products', (req, res) => {
  try {
    const products = getProducts();
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// API: Add product (admin)
app.post('/api/products', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const products = getProducts();
    const newProduct = {
      id: String(Date.now()),
      name: req.body.name || 'New Product',
      price: Number(req.body.price) || 0,
      image: req.body.image || ''
    };
    products.push(newProduct);
    saveProducts(products);
    res.json(newProduct);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add product' });
  }
});

// API: Update product (admin)
app.put('/api/products/:id', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Product not found' });
    products[idx] = { ...products[idx], ...req.body, id: products[idx].id };
    saveProducts(products);
    res.json(products[idx]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// API: Delete product (admin)
app.delete('/api/products/:id', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const products = getProducts().filter(p => p.id !== req.params.id);
    saveProducts(products);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// API: Upload image (admin)
app.post('/api/upload', (req, res, next) => {
  const pwd = req.headers['x-admin-password'];
  if (pwd !== getConfig().adminPassword) return res.status(401).json({ error: 'Unauthorized' });
  next();
}, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 5MB)' });
      return res.status(500).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file selected' });
  res.json({ path: 'uploads/' + req.file.filename });
});

// API: Login check
app.post('/api/login', (req, res) => {
  const ok = isAuthenticated(req);
  res.json({ ok });
});

// API: Create order (public)
app.post('/api/orders', (req, res) => {
  try {
    const newOrder = normalizeOrder(req.body || {});
    if (!newOrder.customer.name || !newOrder.customer.phone || !newOrder.customer.address || !newOrder.customer.city) {
      return res.status(400).json({ error: 'Missing required customer information' });
    }

    const orders = getOrders();
    if (orders.some((order) => order.orderId === newOrder.orderId)) {
      newOrder.orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
    orders.push(newOrder);
    saveOrders(orders);
    res.status(201).json({ ok: true, order: newOrder });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// API: Get orders (admin)
app.get('/api/orders', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(getOrders());
  } catch (e) {
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// API: Update order status (admin)
app.put('/api/orders/:orderId/status', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const status = toSafeString(req.body?.status).toLowerCase();
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use: ${ORDER_STATUSES.join(', ')}` });
    }

    const orders = getOrders();
    const index = orders.findIndex((order) => String(order.orderId) === String(req.params.orderId));
    if (index === -1) return res.status(404).json({ error: 'Order not found' });

    orders[index] = { ...orders[index], status };
    saveOrders(orders);
    res.json(orders[index]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// API: Get site content (public)
app.get('/api/site', (req, res) => {
  try {
    const site = getSite();
    res.json(site || {});
  } catch (e) {
    res.status(500).json({ error: 'Failed to load site content' });
  }
});

// API: Update site content (admin)
app.put('/api/site', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const current = getSite() || {};
    const updated = { ...current, ...req.body };
    saveSite(updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to save site content' });
  }
});

// API: Update config (admin) — password and fallback image
app.put('/api/config', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const config = getConfig();
    if (req.body.adminPassword != null) config.adminPassword = req.body.adminPassword;
    if (req.body.fallbackImage != null) config.fallbackImage = req.body.fallbackImage;
    fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// API: Get config (admin only — for dashboard, non-sensitive fields)
app.get('/api/config', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const config = getConfig();
    res.json({ fallbackImage: config.fallbackImage || '' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

app.get('/admin.html', (req, res) => res.redirect('/dashboard.html'));
app.get('/', (req, res) => res.redirect('/idex.html'));

app.listen(PORT, '0.0.0.0', () => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`\n  WATEN is live at ${url}`);
  console.log(`  Site:      ${url}/idex.html`);
  console.log(`  Dashboard: ${url}/dashboard.html\n`);
});


