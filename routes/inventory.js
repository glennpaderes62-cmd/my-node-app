const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const { Product, PriceLog } = require('../models');
const { isAuthenticated } = require('../middleware/auth');
const { normalizedHeader, readProductRow } = require('../utils/spreadsheet');

const router = express.Router();
const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/import', isAuthenticated, spreadsheetUpload.single('product_file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Choose an Excel file first.' });
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: 'The first worksheet does not contain product rows.',
      });
    }

    const headers = Object.keys(rows[0]).map(normalizedHeader);
    const requiredHeaders = [
      { label: 'Item', options: ['item'] },
      { label: 'SKU', options: ['sku'] },
      { label: 'Barcode', options: ['barcode'] },
      { label: 'Description', options: ['description'] },
      { label: 'Cost', options: ['cost'] },
      { label: 'Price', options: ['price'] },
    ];
    const missingHeaders = requiredHeaders
      .filter((header) => !header.options.some((option) => headers.includes(option)))
      .map((header) => header.label);

    if (missingHeaders.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required header(s): ${missingHeaders.join(', ')}. Download the template and keep its headers.`,
      });
    }

    let imported = 0;
    let updated = 0;
    const skipped = [];

    for (let index = 0; index < rows.length; index++) {
      const product = readProductRow(rows[index]);
      if (
        !product.item ||
        !product.sku ||
        !product.barcode ||
        !product.description ||
        !Number.isFinite(product.cost) ||
        !Number.isFinite(product.price) ||
        product.cost < 0 ||
        product.price < 0
      ) {
        skipped.push(index + 2);
        continue;
      }

      const existing = await Product.findOne({
        $or: [{ sku: product.sku }, { barcode: product.barcode }],
      });

      if (existing) {
        existing.name = product.item;
        existing.sku = product.sku;
        existing.barcode = product.barcode;
        existing.description = product.description;
        existing.cost = product.cost;
        existing.price = product.price;
        existing.stock = product.stock;
        await existing.save();
        updated++;
      } else {
        await Product.create({
          name: product.item,
          category: 'General',
          price: product.price,
          stock: product.stock,
          sku: product.sku,
          barcode: product.barcode,
          description: product.description,
          cost: product.cost,
        });
        imported++;
      }
    }

    const skippedMessage = skipped.length
      ? ` ${skipped.length} invalid row(s) skipped: ${skipped.join(', ')}.`
      : '';

    res.json({
      success: true,
      message: `${imported} product(s) added and ${updated} product(s) updated.${skippedMessage}`,
    });
  } catch (error) {
    console.error('Product import error:', error.message);
    res.status(400).json({
      success: false,
      message: 'Could not read this Excel file. Use the downloaded .xlsx template.',
    });
  }
});

router.post('/manual-batch', isAuthenticated, async (req, res) => {
  const batchNo = String(req.body.batch_no || '').trim();
  const category = String(req.body.category || 'General').trim() || 'General';
  const expiryDate = String(req.body.expiry_date || '').trim();
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (!batchNo || !items.length) {
    return res.status(400).json({
      success: false,
      message: 'Enter a batch number and at least one product line.',
    });
  }

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

      if (
        !name ||
        !sku ||
        !barcode ||
        !description ||
        !Number.isFinite(cost) ||
        !Number.isFinite(price) ||
        !Number.isFinite(stock) ||
        cost < 0 ||
        price < 0 ||
        stock < 0
      ) {
        invalid.push(index + 1);
        continue;
      }

      const existing = await Product.findOne({ $or: [{ sku }, { barcode }] });

      if (existing) {
        existing.name = name;
        existing.category = category;
        existing.price = price;
        existing.stock = stock;
        existing.batchNo = batchNo;
        existing.expiryDate = expiryDate;
        existing.sku = sku;
        existing.barcode = barcode;
        existing.description = description;
        existing.cost = cost;
        await existing.save();
        updated++;
      } else {
        await Product.create({
          name,
          category,
          price,
          stock,
          batchNo,
          expiryDate,
          sku,
          barcode,
          description,
          cost,
        });
        added++;
      }
    }

    const invalidMessage = invalid.length
      ? ` ${invalid.length} incomplete line(s) were skipped.`
      : '';

    res.json({
      success: true,
      message: `Batch ${batchNo}: ${added} product(s) added and ${updated} updated.${invalidMessage}`,
    });
  } catch (error) {
    console.error('Manual batch entry error:', error.message);
    res.status(500).json({ success: false, message: 'Could not save this product batch.' });
  }
});

router.post('/update-price', isAuthenticated, async (req, res) => {
  const productId = String(req.body.productId || '');
  const price = Number(req.body.price);

  if (!mongoose.Types.ObjectId.isValid(productId) || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid non-negative price.',
    });
  }

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const oldPrice = Number(product.price) || 0;
    product.price = price;
    await product.save();

    await PriceLog.create({
      product: product._id,
      oldPrice,
      newPrice: price,
      changedBy: String(req.session.user || 'system').trim() || 'system',
    });

    res.json({ success: true, message: 'Price updated successfully.' });
  } catch (error) {
    console.error('Update price error:', error.message);
    res.status(500).json({ success: false, message: 'Unable to update the price.' });
  }
});

// Receive delivery and update inventory quantities
router.post('/receive-delivery', isAuthenticated, async (req, res) => {
  const { receiptNo, lines } = req.body || {};
  if (!receiptNo || !Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ success: false, message: 'Provide receiptNo and at least one line.' });
  }

  try {
    // create delivery record
    const deliveryDoc = await require('../models/Delivery').create({
      receiptNo: String(receiptNo).trim(),
      lines: lines.map(l => ({ product: l.product, sku: l.sku || '', name: l.name || '', qty: Number(l.qty) || 0 })),
      createdBy: String(req.session.user || 'system').trim() || 'system',
    });

    // update product stocks
    for (const ln of deliveryDoc.lines) {
      if (!mongoose.Types.ObjectId.isValid(ln.product)) continue;
      await Product.findByIdAndUpdate(ln.product, { $inc: { stock: Number(ln.qty) || 0 } });
    }

    res.json({ success: true, message: 'Delivery received and inventory updated.' });
  } catch (error) {
    console.error('Receive delivery error:', error.message);
    res.status(500).json({ success: false, message: 'Unable to receive delivery.' });
  }
});

router.get('/price-history/:productId', isAuthenticated, async (req, res) => {
  const productId = String(req.params.productId || '');
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID.' });
  }

  try {
    const logs = await PriceLog.find({ product: productId })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean();

    res.json({ success: true, logs });
  } catch (error) {
    console.error('Price history error:', error.message);
    res.status(500).json({ success: false, message: 'Unable to load price history.' });
  }
});

router.get('/export.xlsx', isAuthenticated, async (_req, res) => {
  try {
    const rows = await Product.find()
      .select('name sku barcode description cost price stock')
      .sort({ name: 1 })
      .lean();

    const exportRows = rows.map((product) => ({
      Item: product.name || '',
      SKU: product.sku || '',
      Barcode: product.barcode || '',
      Description: product.description || '',
      Cost: Number(product.cost) || 0,
      Price: Number(product.price) || 0,
      'Margin %': Number(product.price)
        ? (Number(product.price) - (Number(product.cost) || 0)) / Number(product.price)
        : 0,
      'Possible Revenue':
        (Number(product.price) || 0) - (Number(product.cost) || 0),
      Stock: Number(product.stock) || 0,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows, {
      header: [
        'Item',
        'SKU',
        'Barcode',
        'Description',
        'Cost',
        'Price',
        'Margin %',
        'Possible Revenue',
        'Stock',
      ],
    });
    worksheet['!cols'] = [
      { wch: 28 },
      { wch: 18 },
      { wch: 20 },
      { wch: 38 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 18 },
      { wch: 10 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Product Registry');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="product-registry.xlsx"');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
  } catch (error) {
    res.status(500).send('Unable to export product registry.');
  }
});

router.get('/export.pdf', isAuthenticated, async (_req, res) => {
  try {
    const rows = await Product.find()
      .select('name sku barcode description cost price')
      .sort({ name: 1 })
      .lean();

    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Disposition', 'attachment; filename="product-registry.pdf"');
    res.type('application/pdf');
    doc.pipe(res);

    doc.fontSize(18).text('Product Registry', { align: 'center' });
    doc
      .moveDown(0.3)
      .fontSize(9)
      .fillColor('#475569')
      .text(`Generated ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown().fillColor('#111827').fontSize(8);

    const columns = [36, 130, 205, 285, 430, 500, 570, 635, 756];
    const header = [
      'Item',
      'SKU',
      'Barcode',
      'Description',
      'Cost',
      'Price',
      'Margin %',
      'Possible Revenue',
    ];
    const headerY = doc.y;
    header.forEach((label, index) =>
      doc.text(label, columns[index], headerY, {
        width: columns[index + 1] - columns[index] - 5,
      })
    );
    doc.moveDown(0.7);

    rows.forEach((product) => {
      if (doc.y > 535) {
        doc.addPage();
        doc.fontSize(8);
      }

      const margin = Number(product.price)
        ? ((Number(product.price) - (Number(product.cost) || 0)) / Number(product.price)) * 100
        : 0;
      const possibleRevenue = (Number(product.price) || 0) - (Number(product.cost) || 0);
      const values = [
        product.name || '',
        product.sku || '',
        product.barcode || '',
        product.description || '',
        `PHP ${(Number(product.cost) || 0).toFixed(2)}`,
        `PHP ${(Number(product.price) || 0).toFixed(2)}`,
        `${margin.toFixed(1)}%`,
        `PHP ${possibleRevenue.toFixed(2)}`,
      ];
      const rowY = doc.y;
      values.forEach((value, index) =>
        doc.text(value, columns[index], rowY, {
          width: columns[index + 1] - columns[index] - 5,
          ellipsis: true,
        })
      );
      doc.moveDown(1.3);
    });

    doc.end();
  } catch (error) {
    res.status(500).send('Unable to export product registry.');
  }
});

module.exports = router;
