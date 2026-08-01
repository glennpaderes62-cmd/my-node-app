function normalizedHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readProductRow(row) {
  const values = {};
  Object.keys(row).forEach((key) => {
    values[normalizedHeader(key)] = row[key];
  });

  const item = String(values.item || '').trim();
  const sku = String(values.sku || '').trim();
  const barcode = String(values.barcode || '').trim();
  const description = String(values.description || '').trim();
  const cost = Number(values.cost);
  const price = Number(values.price);
  const stock = Number(values.stock || 0);

  return {
    item,
    sku,
    barcode,
    description,
    cost,
    price,
    stock: Number.isFinite(stock) ? stock : 0,
  };
}

module.exports = {
  normalizedHeader,
  readProductRow,
};
