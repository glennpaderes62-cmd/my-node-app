const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Database Setup (SQLite)
const db = new sqlite3.Database('./pharmacy.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to Pharmacy SQLite Database.');
        createTables();
    }
});

function createTables() {
    db.serialize(() => {
        // Products Table na may Batch & Expiry tracking
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            price REAL NOT NULL,
            stock INTEGER NOT NULL,
            batch_no TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            requires_prescription INTEGER DEFAULT 0
        )`);

        // Sales Table
        db.run(`CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total REAL NOT NULL,
            cashier TEXT NOT NULL,
            date TEXT NOT NULL
        )`);

        // Prescriptions Logging Table
        db.run(`CREATE TABLE IF NOT EXISTS prescriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_name TEXT NOT NULL,
            doctor_name TEXT NOT NULL,
            medicine_name TEXT NOT NULL,
            date TEXT NOT NULL
        )`);

        // Default Data kung wala pang laman
        db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
            if (row.count === 0) {
                const stmt = db.prepare("INSERT INTO products (name, category, price, stock, batch_no, expiry_date, requires_prescription) VALUES (?, ?, ?, ?, ?, ?, ?)");
                stmt.run("Biogesic 500mg", "OTC", 7.50, 200, "BCH-2026-01", "2027-12-31", 0);
                stmt.run("Amoxicillin 500mg", "Prescription", 15.00, 100, "BCH-2026-02", "2027-06-30", 1);
                stmt.run("Neozep Non-Drowsy", "OTC", 8.00, 150, "BCH-2026-03", "2028-01-15", 0);
                stmt.run("Losartan 50mg", "Prescription", 12.00, 80, "BCH-2026-04", "2026-10-10", 1);
                stmt.finalize();
            }
        });
    });
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'pharmacy-pos-secret-key',
    resave: false,
    saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Auth Guard
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    res.redirect('/');
}

// Routes
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/pos');
    }
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'pharmacist' && password === '12345') {
        req.session.user = username;
        res.redirect('/pos');
    } else {
        res.render('login', { error: 'Maling username o password! (Gamitin: pharmacist / 12345)' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Pharmacy POS Dashboard
app.get('/pos', isAuthenticated, (req, res) => {
    db.all("SELECT * FROM products", (err, products) => {
        if (err) products = [];
        db.all("SELECT * FROM sales ORDER BY id DESC LIMIT 10", (err, sales) => {
            if (err) sales = [];
            db.all("SELECT * FROM prescriptions ORDER BY id DESC LIMIT 10", (err, prescriptions) => {
                if (err) prescriptions = [];
                res.render('dashboard', { user: req.session.user, products, sales, prescriptions });
            });
        });
    });
});

// Add Product & Inventory Control
app.post('/add-product', isAuthenticated, (req, res) => {
    const { name, category, price, stock, batch_no, expiry_date, requires_prescription } = req.body;
    const reqRx = requires_prescription ? 1 : 0;

    db.run(
        "INSERT INTO products (name, category, price, stock, batch_no, expiry_date, requires_prescription) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [name, category, parseFloat(price), parseInt(stock), batch_no, expiry_date, reqRx],
        (err) => {
            if (err) console.error(err);
            res.redirect('/pos');
        }
    );
});

// Validate & Save Prescription
app.post('/add-prescription', isAuthenticated, (req, res) => {
    const { patient_name, doctor_name, medicine_name } = req.body;
    const date = new Date().toLocaleString();

    db.run(
        "INSERT INTO prescriptions (patient_name, doctor_name, medicine_name, date) VALUES (?, ?, ?, ?)",
        [patient_name, doctor_name, medicine_name, date],
        (err) => {
            if (err) console.error(err);
            res.redirect('/pos');
        }
    );
});

// Checkout API with Stock Deduction & Sales Recording
app.post('/checkout', isAuthenticated, (req, res) => {
    const { cart, total } = req.body;
    if (!cart || cart.length === 0) {
        return res.json({ success: false, message: 'Walang laman ang cart.' });
    }

    const date = new Date().toLocaleString();
    db.run("INSERT INTO sales (total, cashier, date) VALUES (?, ?, ?)", [total, req.session.user, date], function(err) {
        if (err) return res.json({ success: false, message: 'Error sa pag-save ng sale.' });

        const saleId = this.lastID;
        const stmt = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");
        cart.forEach(item => {
            stmt.run(item.qty, item.id);
        });
        stmt.finalize();

        res.json({ success: true, saleId });
    });
});

app.listen(PORT, () => {
    console.log(`Pharmacy POS Server running on http://localhost:${PORT}`);
});