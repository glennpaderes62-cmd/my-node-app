const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const path = require('path');

const scrypt = promisify(crypto.scrypt);
const app = express();
const PORT = process.env.PORT || 4080;
const ALL_PAGES = ['pos', 'inventory', 'prescriptions', 'sales', 'admin', 'users'];
const ADMIN_ROLES = new Set(['superadmin', 'admin']);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET is not set. Sessions will end whenever the server restarts.');
}

app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.locals.csrfToken = req.session.csrfToken;
    next();
});

app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const supplied = req.get('x-csrf-token') || req.body?._csrf;
    const expected = req.session.csrfToken || '';
    if (typeof supplied !== 'string' || !expected || supplied.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return res.status(403).send('Invalid request token. Please refresh the page and try again.');
    }
    next();
});

const dbPath = path.join(__dirname, 'pharmacy.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log(`Connected to SQLite database (${dbPath}).`);
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

function normalizeText(value, maxLength = 120) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scrypt(password, salt, 64);
    return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string') return false;
    if (!stored.startsWith('scrypt$')) {
        const supplied = Buffer.from(password);
        const saved = Buffer.from(stored);
        return supplied.length === saved.length && crypto.timingSafeEqual(supplied, saved);
    }
    const [, salt, savedHash] = stored.split('$');
    if (!salt || !savedHash) return false;
    const derived = await scrypt(password, salt, 64);
    const saved = Buffer.from(savedHash, 'hex');
    return saved.length === derived.length && crypto.timingSafeEqual(saved, derived);
}

function isAdmin(req) {
    return ADMIN_ROLES.has(String(req.session.role || '').toLowerCase());
}

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

async function hasPageAccess(req, page) {
    if (isAdmin(req)) return true;
    const row = await dbGet('SELECT 1 FROM user_permissions WHERE username = ? AND page_name = ?', [req.session.user, page]);
    return Boolean(row);
}

function requirePage(page) {
    return async (req, res, next) => {
        try {
            if (!req.session.user) return res.status(401).send('Authentication required.');
            if (await hasPageAccess(req, page)) return next();
            return res.status(403).send('You do not have permission to perform this action.');
        } catch (err) {
            next(err);
        }
    };
}

function requireAdmin(req, res, next) {
    if (isAdmin(req)) return next();
    return res.status(403).send('Administrator access is required.');
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0), stock INTEGER NOT NULL CHECK(stock >= 0), batch_no TEXT, expiry_date TEXT, requires_prescription INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS prescriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_name TEXT NOT NULL, doctor_name TEXT NOT NULL, medicine_name TEXT NOT NULL, date TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, total REAL NOT NULL, cashier TEXT NOT NULL, date TEXT NOT NULL, receipt_data TEXT)`);
    db.run('ALTER TABLE sales ADD COLUMN receipt_data TEXT', () => {});
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS user_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, page_name TEXT NOT NULL, UNIQUE(username, page_name))`);

    db.get('SELECT id FROM users WHERE username = ?', ['superadmin'], async (err, row) => {
        if (err || row || !process.env.SUPERADMIN_PASSWORD) return;
        try {
            await dbRun('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['superadmin', await hashPassword(process.env.SUPERADMIN_PASSWORD), 'superadmin']);
            console.log('Created superadmin from SUPERADMIN_PASSWORD.');
        } catch (createErr) { console.error('Unable to create superadmin:', createErr.message); }
    });
});

app.use(async (req, res, next) => {
    if (req.path === '/login' || req.path === '/logout') return next();
    try {
        const row = await dbGet("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        if (row?.value === '1' && !isAdmin(req)) {
            return res.status(503).send('<div style="text-align:center; margin-top:100px; font-family:sans-serif;"><h1>System Under Maintenance</h1><p>Kasalukuyang inaayos ang sistema. Mangyaring bumalik mamaya.</p></div>');
        }
        next();
    } catch (err) { next(err); }
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res, next) => {
    try {
        const username = normalizeText(req.body.username, 50);
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || !await verifyPassword(password, user.password)) return res.status(401).render('login', { error: 'Invalid username or password' });

        if (!user.password.startsWith('scrypt$')) await dbRun('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), user.id]);
        req.session.regenerate(err => {
            if (err) return next(err);
            req.session.user = user.username;
            req.session.role = user.role;
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');
            res.redirect('/');
        });
    } catch (err) { next(err); }
});

app.get('/logout', (req, res, next) => req.session.destroy(err => err ? next(err) : res.redirect('/login')));

app.get('/', isAuthenticated, async (req, res, next) => {
    try {
        const [products, prescriptions, sales, settingsRows, usersList, permissionsRows] = await Promise.all([
            dbAll('SELECT * FROM products'), dbAll('SELECT * FROM prescriptions ORDER BY id DESC'), dbAll('SELECT * FROM sales ORDER BY id DESC'),
            dbAll('SELECT * FROM settings'), dbAll('SELECT id, username, role FROM users ORDER BY id ASC'), dbAll('SELECT username, page_name FROM user_permissions')
        ]);
        const settings = Object.fromEntries(settingsRows.map(row => [row.key, row.value]));
        const userPermissions = permissionsRows.reduce((all, row) => { (all[row.username] ||= []).push(row.page_name); return all; }, {});
        const allowedPages = isAdmin(req) ? ALL_PAGES : (userPermissions[req.session.user] || []);
        const inventorySummary = {
            totalProducts: products.length,
            totalStockValue: products.reduce((sum, p) => sum + (Number(p.price) * Number(p.stock)), 0),
            lowStockCount: products.filter(p => p.stock <= 10).length,
            prescriptionCount: products.filter(p => Number(p.requires_prescription) === 1).length,
            categoryCounts: products.reduce((counts, p) => { const category = p.category || 'Unspecified'; counts[category] = (counts[category] || 0) + 1; return counts; }, {}),
            lowStockThreshold: 10
        };
        res.render('dashboard', { user: req.session.user, role: String(req.session.role).toLowerCase(), products, prescriptions, sales, settings, inventorySummary, usersList, userPermissions, allowedPages });
    } catch (err) { next(err); }
});

app.post('/admin/branding', isAuthenticated, requireAdmin, async (req, res, next) => {
    try {
        const appName = normalizeText(req.body.app_name, 80);
        const logoUrl = normalizeText(req.body.app_logo_url, 2048);
        if (!appName || (logoUrl && !/^https?:\/\//i.test(logoUrl))) return res.status(400).send('Please provide a valid application name and logo URL.');
        await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('app_name', ?)", [appName]);
        await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('app_logo_url', ?)", [logoUrl]);
        res.redirect('/');
    } catch (err) { next(err); }
});

app.post('/admin/maintenance', isAuthenticated, requireAdmin, async (req, res, next) => {
    try { await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('maintenance_mode', ?)", [req.body.maintenance_mode ? '1' : '0']); res.redirect('/'); }
    catch (err) { next(err); }
});

app.post('/admin/create-user', isAuthenticated, requireAdmin, async (req, res, next) => {
    try {
        const username = normalizeText(req.body.username, 50);
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        const role = normalizeText(req.body.role, 20).toLowerCase();
        const pages = [...new Set(Array.isArray(req.body.allowed_pages) ? req.body.allowed_pages : req.body.allowed_pages ? [req.body.allowed_pages] : [])].filter(page => ALL_PAGES.includes(page));
        if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username) || password.length < 12 || !['cashier', 'pharmacist', 'admin'].includes(role)) return res.status(400).send('User details are invalid. Passwords must be at least 12 characters.');
        await dbRun('BEGIN IMMEDIATE');
        await dbRun('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, await hashPassword(password), role]);
        for (const page of pages) await dbRun('INSERT INTO user_permissions (username, page_name) VALUES (?, ?)', [username, page]);
        await dbRun('COMMIT');
        res.redirect('/');
    } catch (err) { try { await dbRun('ROLLBACK'); } catch {} next(err); }
});

app.post('/admin/update-user-access', isAuthenticated, requireAdmin, async (req, res, next) => {
    try {
        const username = normalizeText(req.body.username, 50);
        const user = await dbGet('SELECT username, role FROM users WHERE username = ?', [username]);
        if (!user || user.role === 'superadmin') return res.status(400).send('This user cannot be modified.');
        const pages = [...new Set(Array.isArray(req.body.allowed_pages) ? req.body.allowed_pages : req.body.allowed_pages ? [req.body.allowed_pages] : [])].filter(page => ALL_PAGES.includes(page));
        await dbRun('BEGIN IMMEDIATE');
        await dbRun('DELETE FROM user_permissions WHERE username = ?', [username]);
        for (const page of pages) await dbRun('INSERT INTO user_permissions (username, page_name) VALUES (?, ?)', [username, page]);
        await dbRun('COMMIT');
        res.redirect('/');
    } catch (err) { try { await dbRun('ROLLBACK'); } catch {} next(err); }
});

app.post('/add-product', requirePage('inventory'), async (req, res, next) => {
    try {
        const name = normalizeText(req.body.name, 160), category = normalizeText(req.body.category, 80), batchNo = normalizeText(req.body.batch_no, 80), expiryDate = normalizeText(req.body.expiry_date, 10);
        const price = Number(req.body.price), stock = Number(req.body.stock);
        if (!name || !category || !batchNo || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0 || !validDate(expiryDate)) return res.status(400).send('Product details are invalid.');
        await dbRun('INSERT INTO products (name, category, price, stock, batch_no, expiry_date, requires_prescription) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, category, price, stock, batchNo, expiryDate, req.body.requires_prescription ? 1 : 0]);
        res.redirect('/');
    } catch (err) { next(err); }
});

app.post('/add-prescription', requirePage('prescriptions'), async (req, res, next) => {
    try {
        const patientName = normalizeText(req.body.patient_name, 120), doctorName = normalizeText(req.body.doctor_name, 120), medicineName = normalizeText(req.body.medicine_name, 160);
        if (!patientName || !doctorName || !medicineName) return res.status(400).send('Prescription details are required.');
        await dbRun('INSERT INTO prescriptions (patient_name, doctor_name, medicine_name, date) VALUES (?, ?, ?, ?)', [patientName, doctorName, medicineName, new Date().toISOString()]);
        res.redirect('/');
    } catch (err) { next(err); }
});

app.post('/checkout', requirePage('pos'), async (req, res, next) => {
    try {
        const { cart, paymentMethod } = req.body;
        const tendered = Number(req.body.tendered);
        if (!Array.isArray(cart) || !cart.length || cart.length > 100 || !['Cash', 'GCash', 'Card'].includes(paymentMethod)) return res.status(400).json({ success: false, message: 'Invalid checkout request.' });
        const requestedItems = new Map();
        for (const item of cart) {
            const id = Number(item.id), qty = Number(item.qty);
            if (!Number.isSafeInteger(id) || !Number.isSafeInteger(qty) || qty < 1 || qty > 10000) throw new Error('Invalid item quantity.');
            requestedItems.set(id, (requestedItems.get(id) || 0) + qty);
        }
        await dbRun('BEGIN IMMEDIATE');
        const confirmedCart = [];
        let total = 0;
        for (const [id, qty] of requestedItems) {
            const product = await dbGet('SELECT id, name, price, stock, expiry_date, requires_prescription FROM products WHERE id = ?', [id]);
            if (!product) throw new Error('A product no longer exists.');
            if (product.stock < qty) throw new Error(`${product.name} does not have enough stock.`);
            if (product.expiry_date && new Date(`${product.expiry_date}T23:59:59`) < new Date()) throw new Error(`${product.name} is expired and cannot be sold.`);
            const submitted = cart.find(item => Number(item.id) === id) || {};
            const requestedPrice = Number(submitted.price), requestedDiscount = Number(submitted.discount || 0);
            const mayOverridePrice = isAdmin(req);
            const price = mayOverridePrice && Number.isFinite(requestedPrice) && requestedPrice >= 0 && requestedPrice <= product.price ? requestedPrice : Number(product.price);
            const maxDiscount = price * qty;
            const discount = mayOverridePrice && Number.isFinite(requestedDiscount) && requestedDiscount >= 0 && requestedDiscount <= maxDiscount ? requestedDiscount : 0;
            const lineTotal = price * qty - discount;
            total += lineTotal;
            confirmedCart.push({ id: product.id, name: product.name, price, originalPrice: Number(product.price), qty, discount, requiresPrescription: Boolean(product.requires_prescription) });
        }
        total = Number(total.toFixed(2));
        if (paymentMethod === 'Cash' && (!Number.isFinite(tendered) || tendered < total)) throw new Error('Insufficient payment.');
        const date = new Date().toISOString();
        const receiptData = { saleId: 'TEMP', date, cashier: req.session.user, cart: confirmedCart, total, vatableSales: Number((total / 1.12).toFixed(2)), vatAmount: Number((total - total / 1.12).toFixed(2)), paymentMethod, tendered: paymentMethod === 'Cash' ? tendered : total, change: paymentMethod === 'Cash' ? Number((tendered - total).toFixed(2)) : 0 };
        const sale = await dbRun('INSERT INTO sales (total, cashier, date, receipt_data) VALUES (?, ?, ?, ?)', [total, req.session.user, date, JSON.stringify(receiptData)]);
        receiptData.saleId = sale.lastID;
        for (const item of confirmedCart) {
            const update = await dbRun('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.qty, item.id, item.qty]);
            if (update.changes !== 1) throw new Error('Stock changed during checkout. Please try again.');
        }
        await dbRun('UPDATE sales SET receipt_data = ? WHERE id = ?', [JSON.stringify(receiptData), sale.lastID]);
        await dbRun('COMMIT');
        res.json({ success: true, saleId: sale.lastID, receiptData });
    } catch (err) {
        try { await dbRun('ROLLBACK'); } catch {}
        res.status(400).json({ success: false, message: err.message || 'Checkout failed.' });
    }
});

app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).send('An unexpected server error occurred.');
});

app.listen(PORT, () => console.log(`RxPOS server running at http://localhost:${PORT}`));
