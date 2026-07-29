const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./pos.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price REAL,
        stock INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total REAL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
        if (row.count === 0) {
            const stmt = db.prepare("INSERT INTO products (name, price, stock) VALUES (?, ?, ?)");
            stmt.run("Coffee", 120.00, 50);
            stmt.run("Bread", 50.00, 100);
            stmt.run("Juice", 80.00, 30);
            stmt.finalize();
        }
    });
});

module.exports = db;