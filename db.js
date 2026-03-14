const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error("Error opening database " + err.message);
    } else {
        console.log("Connected to the SQLite database.");
        
        db.serialize(() => {
            // Create Table: Products
            db.run(`CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                image TEXT
            )`);
            
            // Create Table: Users
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                phone TEXT
            )`);
            
            // Create Table: Orders
            db.run(`CREATE TABLE IF NOT EXISTS orders (
                orderId TEXT PRIMARY KEY,
                productId TEXT NOT NULL,
                productName TEXT NOT NULL,
                unitPrice REAL NOT NULL,
                productImage TEXT,
                customerName TEXT NOT NULL,
                customerPhone TEXT NOT NULL,
                customerEmail TEXT,
                customerAddress TEXT NOT NULL,
                customerCity TEXT NOT NULL,
                customerPostalCode TEXT,
                quantity INTEGER NOT NULL,
                notes TEXT,
                totalPrice REAL NOT NULL,
                orderDate TEXT NOT NULL,
                status TEXT NOT NULL
            )`);
            
            // Data Migration (Optional on start)
            migrateProducts(db);
            migrateOrders(db);
        });
    }
});

function migrateProducts(db) {
    const productsFile = path.join(DATA_DIR, 'products.json');
    if (fs.existsSync(productsFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
            if (data.products && Array.isArray(data.products)) {
                console.log("Migrating products from JSON...");
                const stmt = db.prepare("INSERT OR REPLACE INTO products (id, name, price, image) VALUES (?, ?, ?, ?)");
                data.products.forEach(p => {
                    stmt.run(p.id, p.name, p.price, p.image);
                });
                stmt.finalize();
                console.log("Products migrated successfully.");
                
                // Optionally rename to prevent duplicate runs
                fs.renameSync(productsFile, productsFile + '.migrated');
            }
        } catch(e) { console.error("Could not migrate products:", e); }
    }
}

function migrateOrders(db) {
    const ordersFile = path.join(DATA_DIR, 'orders.json');
    if (fs.existsSync(ordersFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
            const orders = Array.isArray(data) ? data : (data.orders || []);
            
            if (orders.length > 0) {
                console.log("Migrating orders from JSON...");
                const stmt = db.prepare(`INSERT OR REPLACE INTO orders 
                    (orderId, productId, productName, unitPrice, productImage, 
                    customerName, customerPhone, customerEmail, customerAddress, 
                    customerCity, customerPostalCode, quantity, notes, totalPrice, 
                    orderDate, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                
                orders.forEach(o => {
                    stmt.run(
                        o.orderId,
                        o.product?.id || '',
                        o.product?.name || 'Unknown',
                        o.product?.price || 0,
                        o.product?.image || '',
                        o.customer?.name || '',
                        o.customer?.phone || '',
                        o.customer?.email || '',
                        o.customer?.address || '',
                        o.customer?.city || '',
                        o.customer?.postalCode || '',
                        o.quantity || 1,
                        o.notes || '',
                        o.totalPrice || 0,
                        o.orderDate || new Date().toISOString(),
                        o.status || 'pending'
                    );
                });
                stmt.finalize();
                console.log("Orders migrated successfully.");
                fs.renameSync(ordersFile, ordersFile + '.migrated');
            }
        } catch(e) { console.error("Could not migrate orders:", e); }
    }
}

module.exports = db;
