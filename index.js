const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4080;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'rxpos_secure_secret_key',
    resave: false,
    saveUninitialized: true
}));

const dbPath = path.join(__dirname, 'pharmacy.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log(`Connected to SQLite database (${dbPath}).`);
});

// Database Tables Initialization
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        category TEXT,
        price REAL,
        stock INTEGER,
        batch_no TEXT,
        expiry_date TEXT,
        requires_prescription INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS prescriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_name TEXT,
        doctor_name TEXT,
        medicine_name TEXT,
        date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total REAL,
        cashier TEXT,
        date TEXT,
        receipt_data TEXT
    )`, () => {
        db.run(`ALTER TABLE sales ADD COLUMN receipt_data TEXT`, () => {});
    });

    // New tables para sa Admin Features
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        page_name TEXT
    )`);

    // Default Super Admin / Creator account
    db.get(`SELECT * FROM users WHERE username = ?`, ['superadmin'], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, ['superadmin', 'admin123', 'superadmin']);
        }
    });
});

// Middleware para sa Maintenance Mode
app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/logout') {
        return next();
    }

    db.get(`SELECT value FROM settings WHERE key = 'maintenance_mode'`, (err, row) => {
        const isMaintenance = row && row.value === '1';
        
        if (isMaintenance) {
            // Superadmin o creator lang ang makakapasok kapag naka-maintenance
            if (req.session.user === 'superadmin' || req.session.user === 'creator') {
                return next();
            }
            return res.send(`
                <div style="text-align:center; margin-top:100px; font-family:sans-serif;">
                    <h1>🛠️ System Under Maintenance</h1>
                    <p>Kasalukuyang inaayos ang sistema ng creator. Mangyaring bumalik mamaya.</p>
                </div>
            `);
        }
        next();
    });
});

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

// Routes
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (user) {
            req.session.user = user.username;
            req.session.role = user.role;
            res.redirect('/');
        } else {
            res.render('login', { error: 'Invalid username or password' });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

app.get('/', isAuthenticated, (req, res) => {
    db.all(`SELECT * FROM products`, [], (err, products) => {
        db.all(`SELECT * FROM prescriptions ORDER BY id DESC`, [], (err, prescriptions) => {
            db.all(`SELECT * FROM sales ORDER BY id DESC`, [], (err, sales) => {
                db.all(`SELECT * FROM settings`, [], (err, settingsRows) => {
                    const settings = {};
                    if (settingsRows) {
                        settingsRows.forEach(row => { settings[row.key] = row.value; });
                    }

                    const allProducts = products || [];
                    const lowStockThreshold = 10;
                    const inventorySummary = {
                        totalProducts: allProducts.length,
                        totalStockValue: allProducts.reduce((sum, p) => sum + (p.price * p.stock), 0),
                        lowStockCount: allProducts.filter(p => p.stock <= lowStockThreshold).length,
                        prescriptionCount: allProducts.filter(p => p.requires_prescription === 1 || p.requires_prescription === '1').length,
                        categoryCounts: allProducts.reduce((counts, p) => {
                            const category = p.category || 'Unspecified';
                            counts[category] = (counts[category] || 0) + 1;
                            return counts;
                        }, {}),
                        lowStockThreshold
                    };

                    const allPages = ['pos', 'inventory', 'prescriptions', 'sales', 'end_of_day', 'admin', 'users'];

                    db.all(`SELECT * FROM users ORDER BY id ASC`, [], (err, usersList) => {
                        if (err) {
                            console.error('usersList query error:', err.message);
                        }
                        console.log('usersList load count:', Array.isArray(usersList) ? usersList.length : 0);
                        db.all(`SELECT * FROM user_permissions`, [], (err, permissionsRows) => {
                            if (err) {
                                console.error('permissions query error:', err.message);
                            }

                            const userPermissions = {};
                            if (permissionsRows) {
                                permissionsRows.forEach(row => {
                                    const usernameKey = String(row.username || '').trim();
                                    if (!userPermissions[usernameKey]) userPermissions[usernameKey] = [];
                                    userPermissions[usernameKey].push(row.page_name);
                                });
                            }

                            const currentUser = String(req.session.user || '').trim();
                            const currentRole = String(req.session.role || '').trim().toLowerCase();
                            const allowedPages = ['superadmin', 'admin'].includes(currentRole)
                                ? allPages
                                : (userPermissions[currentUser] || []);

                            console.log('dashboard render', {
                                currentUser,
                                currentRole,
                                usersCount: Array.isArray(usersList) ? usersList.length : 0,
                                allowedPages,
                                userPermissionsForCurrent: userPermissions[currentUser] || []
                            });

                            res.render('dashboard', {
                                user: currentUser,
                                role: currentRole,
                                products: allProducts,
                                prescriptions: prescriptions || [],
                                sales: sales || [],
                                settings: settings,
                                inventorySummary,
                                usersList: usersList || [],
                                userPermissions,
                                allowedPages
                            });
                        });
                    });
                });
            });
        });
    });
});

// Admin Features Routes
app.post('/admin/branding', isAuthenticated, (req, res) => {
    const { app_name, app_logo_url } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('app_name', ?)`, [app_name], () => {
        db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('app_logo_url', ?)`, [app_logo_url || ''], () => {
            res.redirect('/');
        });
    });
});

app.post('/admin/maintenance', isAuthenticated, (req, res) => {
    const { maintenance_mode } = req.body;
    const val = maintenance_mode ? '1' : '0';
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('maintenance_mode', ?)`, [val], () => {
        res.redirect('/');
    });
});

app.post('/admin/create-user', isAuthenticated, (req, res) => {
    const { username, password, role, allowed_pages } = req.body;
    const pages = Array.isArray(allowed_pages)
        ? allowed_pages
        : (allowed_pages ? [allowed_pages] : []);

    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, [username, password, role], function(err) {
        if (err) {
            console.error('Create user error:', err.message);
            return res.redirect('/');
        }

        if (pages.length > 0) {
            const stmt = db.prepare(`INSERT INTO user_permissions (username, page_name) VALUES (?, ?)`);
            pages.forEach(page => {
                stmt.run(username, page);
            });
            stmt.finalize(() => res.redirect('/'));
        } else {
            res.redirect('/');
        }
    });
});

app.post('/admin/update-user-access', isAuthenticated, (req, res) => {
    const { username, allowed_pages } = req.body;
    const pages = Array.isArray(allowed_pages)
        ? allowed_pages
        : (allowed_pages ? [allowed_pages] : []);

    db.run(`DELETE FROM user_permissions WHERE username = ?`, [username], (err) => {
        if (err) return res.redirect('/');

        if (pages.length > 0) {
            const stmt = db.prepare(`INSERT INTO user_permissions (username, page_name) VALUES (?, ?)`);
            pages.forEach(page => {
                stmt.run(username, page);
            });
            stmt.finalize(() => res.redirect('/'));
        } else {
            res.redirect('/');
        }
    });
});

// Standard POS Routes
app.post('/add-product', isAuthenticated, (req, res) => {
    const { name, category, price, stock, batch_no, expiry_date, requires_prescription } = req.body;
    const reqRx = requires_prescription ? 1 : 0;
    db.run(`INSERT INTO products (name, category, price, stock, batch_no, expiry_date, requires_prescription) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, category, price, stock, batch_no, expiry_date, reqRx], (err) => {
            res.redirect('/');
        });
});

app.post('/add-prescription', isAuthenticated, (req, res) => {
    const { patient_name, doctor_name, medicine_name } = req.body;
    const date = new Date().toLocaleDateString();
    db.run(`INSERT INTO prescriptions (patient_name, doctor_name, medicine_name, date) VALUES (?, ?, ?, ?)`,
        [patient_name, doctor_name, medicine_name, date], (err) => {
            res.redirect('/');
        });
});

app.post('/checkout', isAuthenticated, (req, res) => {
    const { cart, total, paymentMethod, tendered } = req.body;
    const cashier = req.session.user || 'Cashier';
    const date = new Date().toLocaleString();

    const vatAmount = total * 0.12;
    const vatableSales = total - vatAmount;

    const receiptDataObj = {
        saleId: 'TEMP',
        date,
        cashier,
        cart,
        total,
        vatableSales,
        vatAmount,
        paymentMethod,
        tendered: paymentMethod === 'Cash' ? tendered : total,
        change: paymentMethod === 'Cash' ? tendered - total : 0
    };

    db.run(`INSERT INTO sales (total, cashier, date, receipt_data) VALUES (?, ?, ?, ?)`, 
        [total, cashier, date, JSON.stringify(receiptDataObj)], function(err) {
        if (err) {
            return res.json({ success: false, message: err.message });
        }
        const saleId = this.lastID;
        receiptDataObj.saleId = saleId;

        db.run(`UPDATE sales SET receipt_data = ? WHERE id = ?`, [JSON.stringify(receiptDataObj), saleId]);

        cart.forEach(item => {
            db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.qty, item.id]);
        });

        res.json({ 
            success: true, 
            saleId, 
            receiptData: receiptDataObj
        });
    });
});

app.listen(PORT, () => {
    console.log(`RxPOS server running at http://localhost:${PORT}`);
});
