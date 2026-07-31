const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 4080;
const spreadsheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
    )`, () => {
        ['sku TEXT', 'barcode TEXT', 'description TEXT', 'cost REAL DEFAULT 0'].forEach(column => {
            db.run(`ALTER TABLE products ADD COLUMN ${column}`, () => {});
        });
    });

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

function normalizedHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readProductRow(row) {
    const values = {};
    Object.keys(row).forEach(key => { values[normalizedHeader(key)] = row[key]; });
    const item = String(values.item || '').trim();
    const sku = String(values.sku || '').trim();
    const barcode = String(values.barcode || '').trim();
    const description = String(values.description || '').trim();
    const cost = Number(values.cost);
    const price = Number(values.price);
    const stock = Number(values.stock || 0);
    return { item, sku, barcode, description, cost, price, stock: Number.isFinite(stock) ? stock : 0 };
}

function databaseRun(sql, params) {
    return new Promise((resolve, reject) => db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
    }));
}

function databaseGet(sql, params) {
    return new Promise((resolve, reject) => db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    }));
}

// Product Registry: bulk import, export, and price management.
app.post('/inventory/import', isAuthenticated, spreadsheetUpload.single('product_file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose an Excel file first.' });
    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (!rows.length) return res.status(400).json({ success: false, message: 'The first worksheet does not contain product rows.' });

        const headers = Object.keys(rows[0]).map(normalizedHeader);
        const requiredHeaders = [
            { label: 'Item', options: ['item'] }, { label: 'SKU', options: ['sku'] }, { label: 'Barcode', options: ['barcode'] },
            { label: 'Description', options: ['description'] }, { label: 'Cost', options: ['cost'] }, { label: 'Price', options: ['price'] }
        ];
        const missingHeaders = requiredHeaders.filter(header => !header.options.some(option => headers.includes(option))).map(header => header.label);
        if (missingHeaders.length) {
            return res.status(400).json({ success: false, message: `Missing required header(s): ${missingHeaders.join(', ')}. Download the template and keep its headers.` });
        }

        let imported = 0;
        let updated = 0;
        const skipped = [];
        for (let index = 0; index < rows.length; index++) {
            const product = readProductRow(rows[index]);
            if (!product.item || !product.sku || !product.barcode || !product.description || !Number.isFinite(product.cost) || !Number.isFinite(product.price) || product.cost < 0 || product.price < 0) {
                skipped.push(index + 2);
                continue;
            }
            const existing = await databaseGet(
                `SELECT id FROM products WHERE sku = ? OR barcode = ? LIMIT 1`, [product.sku, product.barcode]
            );
            if (existing) {
                await databaseRun(
                    `UPDATE products SET name = ?, sku = ?, barcode = ?, description = ?, cost = ?, price = ?, stock = ? WHERE id = ?`,
                    [product.item, product.sku, product.barcode, product.description, product.cost, product.price, product.stock, existing.id]
                );
                updated++;
            } else {
                await databaseRun(
                    `INSERT INTO products (name, category, price, stock, batch_no, expiry_date, requires_prescription, sku, barcode, description, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [product.item, 'General', product.price, product.stock, '', '', 0, product.sku, product.barcode, product.description, product.cost]
                );
                imported++;
            }
        }
        const skippedMessage = skipped.length ? ` ${skipped.length} invalid row(s) skipped: ${skipped.join(', ')}.` : '';
        res.json({ success: true, message: `${imported} product(s) added and ${updated} product(s) updated.${skippedMessage}` });
    } catch (error) {
        console.error('Product import error:', error.message);
        res.status(400).json({ success: false, message: 'Could not read this Excel file. Use the downloaded .xlsx template.' });
    }
});

app.post('/inventory/manual-batch', isAuthenticated, async (req, res) => {
    const batchNo = String(req.body.batch_no || '').trim();
    const category = String(req.body.category || 'General').trim() || 'General';
    const expiryDate = String(req.body.expiry_date || '').trim();
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!batchNo || !items.length) return res.status(400).json({ success: false, message: 'Enter a batch number and at least one product line.' });
    try {
        let added = 0;
        let updated = 0;
        const invalid = [];
        for (let index = 0; index < items.length; index++) {
            const item = items[index] || {};
            const name = String(item.name || '').trim();
            const sku = String(item.sku || '').trim();
            const barcode = String(item.barcode || '').trim();
            const description = String(item.description || '').trim();
            const cost = Number(item.cost);
            const price = Number(item.price);
            const stock = Number(item.stock);
            if (!name || !sku || !barcode || !description || !Number.isFinite(cost) || !Number.isFinite(price) || !Number.isFinite(stock) || cost < 0 || price < 0 || stock < 0) {
                invalid.push(index + 1);
                continue;
            }
            const existing = await databaseGet(`SELECT id FROM products WHERE sku = ? OR barcode = ? LIMIT 1`, [sku, barcode]);
            if (existing) {
                await databaseRun(`UPDATE products SET name = ?, category = ?, price = ?, stock = ?, batch_no = ?, expiry_date = ?, sku = ?, barcode = ?, description = ?, cost = ? WHERE id = ?`,
                    [name, category, price, stock, batchNo, expiryDate, sku, barcode, description, cost, existing.id]);
                updated++;
            } else {
                await databaseRun(`INSERT INTO products (name, category, price, stock, batch_no, expiry_date, requires_prescription, sku, barcode, description, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [name, category, price, stock, batchNo, expiryDate, 0, sku, barcode, description, cost]);
                added++;
            }
        }
        const invalidMessage = invalid.length ? ` ${invalid.length} incomplete line(s) were skipped.` : '';
        res.json({ success: true, message: `Batch ${batchNo}: ${added} product(s) added and ${updated} updated.${invalidMessage}` });
    } catch (error) {
        console.error('Manual batch entry error:', error.message);
        res.status(500).json({ success: false, message: 'Could not save this product batch.' });
    }
});

app.post('/inventory/update-price', isAuthenticated, async (req, res) => {
    const productId = Number(req.body.productId);
    const price = Number(req.body.price);
    if (!Number.isInteger(productId) || !Number.isFinite(price) || price < 0) {
        return res.status(400).json({ success: false, message: 'Enter a valid non-negative price.' });
    }
    try {
        const result = await databaseRun(`UPDATE products SET price = ? WHERE id = ?`, [price, productId]);
        if (!result.changes) return res.status(404).json({ success: false, message: 'Product not found.' });
        res.json({ success: true, message: 'Price updated successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Unable to update the price.' });
    }
});

app.get('/inventory/export.xlsx', isAuthenticated, (req, res) => {
    db.all(`SELECT id, name, sku, barcode, description, cost, price, stock FROM products ORDER BY name COLLATE NOCASE`, [], (err, rows) => {
        if (err) return res.status(500).send('Unable to export product registry.');
        const exportRows = (rows || []).map(product => ({
            Item: product.name || '', SKU: product.sku || '', Barcode: product.barcode || '', Description: product.description || '',
            Cost: Number(product.cost) || 0, Price: Number(product.price) || 0,
            'Margin %': Number(product.price) ? ((Number(product.price) - (Number(product.cost) || 0)) / Number(product.price)) : 0,
            'Possible Revenue': (Number(product.price) || 0) - (Number(product.cost) || 0), Stock: Number(product.stock) || 0
        }));
        const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: ['Item', 'SKU', 'Barcode', 'Description', 'Cost', 'Price', 'Margin %', 'Possible Revenue', 'Stock'] });
        worksheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 38 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 10 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Product Registry');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="product-registry.xlsx"');
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
    });
});

app.get('/inventory/export.pdf', isAuthenticated, (req, res) => {
    db.all(`SELECT name, sku, barcode, description, cost, price FROM products ORDER BY name COLLATE NOCASE`, [], (err, rows) => {
        if (err) return res.status(500).send('Unable to export product registry.');
        const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-Disposition', 'attachment; filename="product-registry.pdf"');
        res.type('application/pdf');
        doc.pipe(res);
        doc.fontSize(18).text('Product Registry', { align: 'center' });
        doc.moveDown(0.3).fontSize(9).fillColor('#475569').text(`Generated ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown().fillColor('#111827').fontSize(8);
        const columns = [36, 130, 205, 285, 430, 500, 570, 635, 756];
        const header = ['Item', 'SKU', 'Barcode', 'Description', 'Cost', 'Price', 'Margin %', 'Possible Revenue'];
        const headerY = doc.y;
        header.forEach((label, index) => doc.text(label, columns[index], headerY, { width: columns[index + 1] - columns[index] - 5 }));
        doc.moveDown(0.7);
        (rows || []).forEach(product => {
            if (doc.y > 535) { doc.addPage(); doc.fontSize(8); }
            const margin = Number(product.price) ? ((Number(product.price) - (Number(product.cost) || 0)) / Number(product.price)) * 100 : 0;
            const possibleRevenue = (Number(product.price) || 0) - (Number(product.cost) || 0);
            const values = [product.name || '', product.sku || '', product.barcode || '', product.description || '', `PHP ${(Number(product.cost) || 0).toFixed(2)}`, `PHP ${(Number(product.price) || 0).toFixed(2)}`, `${margin.toFixed(1)}%`, `PHP ${possibleRevenue.toFixed(2)}`];
            const rowY = doc.y;
            values.forEach((value, index) => doc.text(value, columns[index], rowY, { width: columns[index + 1] - columns[index] - 5, ellipsis: true }));
            doc.moveDown(1.3);
        });
        doc.end();
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
