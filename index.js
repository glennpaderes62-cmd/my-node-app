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

const db = new sqlite3.Database('./pharmacy_new.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite database (pharmacy.db).');
});

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
        // Awtomatikong idadagdag ang receipt_data kung sakaling lumang table ito
        db.run(`ALTER TABLE sales ADD COLUMN receipt_data TEXT`, () => {});
    });

    db.get(`SELECT * FROM users WHERE username = ?`, ['pharmacist'], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, ['pharmacist', 'password123', 'pharmacist']);
        }
    });
});

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (user) {
            req.session.user = user.username;
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
                res.render('dashboard', {
                    user: req.session.user,
                    products: products || [],
                    prescriptions: prescriptions || [],
                    sales: sales || []
                });
            });
        });
    });
});

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