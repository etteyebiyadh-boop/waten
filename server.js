const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');
const https = require('https');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
require('dotenv').config();

const db = require('./db.js');

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

// Configuration and secrets moved to SQLite & .env when possible
function getConfig() {
  const configPath = path.join(DATA_DIR, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    const defaultConfig = {
      fallbackImage: "https://images.unsplash.com/photo-1556821840-3a63f95609a7"
    };
    try {
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    } catch(err) {} 
    return defaultConfig;
  }
}

function getSitePath() {
  return path.join(DATA_DIR, 'site.json');
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

// JWT Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token == null) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
}

// API: Get products (public)
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to load products' });
    res.json(rows);
  });
});

// API: Add product (admin)
app.post('/api/products', authenticateToken, (req, res) => {
  const newProduct = {
    id: String(Date.now()),
    name: req.body.name || 'New Product',
    price: Number(req.body.price) || 0,
    image: req.body.image || ''
  };

  db.run(`INSERT INTO products (id, name, price, image) VALUES (?, ?, ?, ?)`,
    [newProduct.id, newProduct.name, newProduct.price, newProduct.image],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to add product' });
      res.json(newProduct);
    }
  );
});

// API: Update product (admin)
app.put('/api/products/:id', authenticateToken, (req, res) => {
  const id = req.params.id;
  
  // Basic query building for dynamic updates
  const updates = [];
  const params = [];
  if (req.body.name) { updates.push("name = ?"); params.push(req.body.name); }
  if (req.body.price) { updates.push("price = ?"); params.push(Number(req.body.price)); }
  if (req.body.image) { updates.push("image = ?"); params.push(req.body.image); }
  
  if (updates.length === 0) return res.json({ ok: true });
  
  params.push(id);
  db.run(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`, params, function(err) {
    if (err) return res.status(500).json({ error: 'Failed to update product' });
    res.json({ ok: true, id });
  });
});

// API: Delete product (admin)
app.delete('/api/products/:id', authenticateToken, (req, res) => {
  db.run("DELETE FROM products WHERE id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: 'Failed to delete product' });
      res.json({ ok: true });
  });
});

// API: Upload image (admin)
app.post('/api/upload', authenticateToken, (req, res, next) => {
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

// API: Login generate JWT
const bcrypt = require('bcrypt');

app.post('/api/login', (req, res) => {
  const pwd = req.body.password;
  if (!pwd) return res.status(400).json({ error: 'Password required' });

  // Use dotenv for the new hashed password validation logic
  if (bcrypt.compareSync(pwd, process.env.ADMIN_PASSWORD_HASH)) {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
});

// Notification Helpers
function sendWhatsAppNotification(message) {
  const config = getConfig();
  const phone = config.whatsappNumber;
  const apiKey = config.whatsappApiKey;
  
  if (!phone || !apiKey || phone === '+21600000000' || apiKey === 'YOUR_CALLMEBOT_API_KEY') {
    return;
  }

  const encodedMessage = encodeURIComponent(message);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodedMessage}&apikey=${encodeURIComponent(apiKey)}`;

  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('WhatsApp notification sent'));
  }).on('error', (err) => {
    console.error('WhatsApp notification failed:', err.message);
  });
}

function sendEmailNotification(subject, text) {
  const config = getConfig();
  const user = config.smtpUser;
  const pass = config.smtpPass;
  const toEmail = config.adminEmail;

  if (!user || user === 'your-email@gmail.com' || !pass || pass === 'your-app-password') {
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  const mailOptions = { from: user, to: toEmail, subject, text };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.log('Error sending email:', error);
    else console.log('Email sent:', info.response);
  });
}

function notifyAdmin(order, isUpdate = false) {
  let message = '';
  if (isUpdate) {
    message = `🔄 WATEN ORDER UPDATE!
Order ID: ${order.orderId}
New Status: ${order.status.toUpperCase()}
Customer: ${order.customer.name}
Total: ${order.totalPrice} TND
`;
  } else {
    message = `🎯 NEW WATEN ORDER!
Order ID: ${order.orderId}
Product: ${order.product.name} (x${order.quantity})
Total: ${order.totalPrice} TND

Customer: ${order.customer.name}
Phone: ${order.customer.phone}
Address: ${order.customer.address}, ${order.customer.city}
`;
  }
  
  sendWhatsAppNotification(message);
  sendEmailNotification(
    isUpdate ? `Waten Order Update ${order.orderId}` : `New Waten Order ${order.orderId}`,
    message
  );
}

// Input Validation Schemas
const orderSchema = z.object({
  product: z.object({
    id: z.string().optional(),
    name: z.string(),
    price: z.number().min(0).or(z.string().regex(/^\d+(\.\d{1,2})?$/).transform(Number)),
    image: z.string().optional()
  }).optional(),
  customer: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    phone: z.string().min(8, 'Phone is required').max(20),
    email: z.string().email('Invalid email').optional().or(z.literal('')),
    address: z.string().min(5, 'Address is required').max(250),
    city: z.string().min(2, 'City is required').max(50),
    postalCode: z.string().optional()
  }),
  quantity: z.number().int().min(1).max(100).or(z.string().regex(/^\d+$/).transform(Number)),
  notes: z.string().max(500).optional()
}).passthrough();

// API: Create order (public)
app.post('/api/orders', (req, res) => {
  // Validate request
  const validationResult = orderSchema.safeParse(req.body);
  if (!validationResult.success) {
      return res.status(400).json({ 
          error: 'Validation failed', 
          details: validationResult.error.errors 
      });
  }

  const newOrder = normalizeOrder(req.body || {});
  if (!newOrder.customer.name || !newOrder.customer.phone || !newOrder.customer.address || !newOrder.customer.city) {
    return res.status(400).json({ error: 'Missing required customer information' });
  }

  // Generate safer random order IDs
  db.get("SELECT orderId FROM orders WHERE orderId = ?", [newOrder.orderId], (err, row) => {
      let finalOrderId = newOrder.orderId;
      if (row) {
          finalOrderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      }
      
      db.run(`INSERT INTO orders 
      (orderId, productId, productName, unitPrice, productImage, 
      customerName, customerPhone, customerEmail, customerAddress, 
      customerCity, customerPostalCode, quantity, notes, totalPrice, 
      orderDate, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
          finalOrderId,
          newOrder.product?.id || '',
          newOrder.product?.name || 'Unknown',
          newOrder.product?.price || 0,
          newOrder.product?.image || '',
          newOrder.customer?.name || '',
          newOrder.customer?.phone || '',
          newOrder.customer?.email || '',
          newOrder.customer?.address || '',
          newOrder.customer?.city || '',
          newOrder.customer?.postalCode || '',
          newOrder.quantity || 1,
          newOrder.notes || '',
          newOrder.totalPrice || 0,
          newOrder.orderDate || new Date().toISOString(),
          newOrder.status || 'pending'
      ], function(err) {
          if (err) return res.status(500).json({ error: 'Failed to save order' });
          
          newOrder.orderId = finalOrderId;
          // Trigger Notifications!
          notifyAdmin(newOrder, false);

          res.status(201).json({ ok: true, order: newOrder });
      });
  });
});

// API: Get orders (admin)
app.get('/api/orders', authenticateToken, (req, res) => {
  db.all("SELECT * FROM orders ORDER BY orderDate DESC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to load orders' });
      
      // Remap flat structure back to deeply nested for frontend compatibility
      const mappedOrders = rows.map(r => ({
          orderId: r.orderId,
          product: { id: r.productId, name: r.productName, price: r.unitPrice, image: r.productImage },
          customer: { name: r.customerName, phone: r.customerPhone, email: r.customerEmail, address: r.customerAddress, city: r.customerCity, postalCode: r.customerPostalCode },
          quantity: r.quantity,
          notes: r.notes,
          totalPrice: r.totalPrice,
          orderDate: r.orderDate,
          status: r.status
      }));
      res.json(mappedOrders);
  });
});

// API: Update order status (admin)
app.put('/api/orders/:orderId/status', authenticateToken, (req, res) => {
  const status = toSafeString(req.body?.status).toLowerCase();
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Use: ${ORDER_STATUSES.join(', ')}` });
  }

  db.run("UPDATE orders SET status = ? WHERE orderId = ?", [status, req.params.orderId], function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update order status' });
      
      if (this.changes === 0) return res.status(404).json({ error: 'Order not found' });
      
      res.json({ ok: true, status });
      // To strictly trigger the notification, you usually want to re-query the order first, but we can omit that feature here or re-select.
  });
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
app.put('/api/site', authenticateToken, (req, res) => {
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
app.put('/api/config', authenticateToken, (req, res) => {
  try {
    const config = getConfig();
    if (req.body.adminPassword != null) config.adminPassword = req.body.adminPassword;
    if (req.body.fallbackImage != null) config.fallbackImage = req.body.fallbackImage;
    if (req.body.whatsappNumber != null) config.whatsappNumber = req.body.whatsappNumber;
    if (req.body.whatsappApiKey != null) config.whatsappApiKey = req.body.whatsappApiKey;
    if (req.body.adminEmail != null) config.adminEmail = req.body.adminEmail;
    if (req.body.smtpUser != null) config.smtpUser = req.body.smtpUser;
    if (req.body.smtpPass != null) config.smtpPass = req.body.smtpPass;
    fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// API: Get config (admin only)
app.get('/api/config', authenticateToken, (req, res) => {
  try {
    const config = getConfig();
    res.json({ 
      fallbackImage: config.fallbackImage || '',
      whatsappNumber: config.whatsappNumber || '',
      whatsappApiKey: config.whatsappApiKey || '',
      adminEmail: config.adminEmail || '',
      smtpUser: config.smtpUser || '',
      smtpPass: config.smtpPass || '' // Returned safely since it's admin-only
    });
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


