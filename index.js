const express = require('express');
const session = require('express-session');
const db = require('./database');
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'sikreto-mo-to',
    resave: false,
    saveUninitialized: true
}));

const ADMIN_USER = "admin";
const ADMIN_PASS = "12345";

// Login Page / Root Route
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/pos');
    }
    res.render('dashboard', { error: null, user: null, products: [] });
});

// Login POST Route
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    console.log("Login attempt received for username:", username);
    
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.user = username;
        res.redirect('/pos');
    } else {
        res.render('dashboard', { error: 'Maling username o password!', user: null, products: [] });
    }
});

// POS Screen Route
app.get('/pos', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    db.all("SELECT * FROM products", (err, products) => {
        if (err) products = [];
        res.render('dashboard', { error: null, user: req.session.user, products });
    });
});

// Checkout / Save Transaction
app.post('/checkout', (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    const { total } = req.body;

    db.run("INSERT INTO sales (total) VALUES (?)", [total], function(err) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, saleId: this.lastID });
    });
});

// Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});