const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;
const IMAGES_DIR = path.join(DATA_DIR, 'images');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_DIR),
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
}, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ path: 'images/' + req.file.filename });
});

// API: Login check
app.post('/api/login', (req, res) => {
  const ok = isAuthenticated(req);
  res.json({ ok });
});

app.get('/', (req, res) => res.redirect('/idex.html'));

app.listen(PORT, '0.0.0.0', () => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`\n  WATEN is live at ${url}`);
  console.log(`  Site:      ${url}/idex.html`);
  console.log(`  Dashboard: ${url}/admin.html\n`);
});
