const express = require('express');
const mongoose = require('mongoose');
const { Product, Prescription, Sale } = require('../models');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.post('/add-product', isAuthenticated, async (req, res) => {
  try {
    const { name, category, price, stock, batch_no, expiry_date, requires_prescription } =
      req.body;

    await Product.create({
      name,
      category,
      price: Number(price),
      stock: Number(stock),
      batchNo: batch_no || '',
      expiryDate: expiry_date || '',
      requiresPrescription: Boolean(requires_prescription),
    });

    res.redirect('/');
  } catch (error) {
    console.error('Add product error:', error.message);
    res.redirect('/');
  }
});

router.post('/add-prescription', isAuthenticated, async (req, res) => {
  try {
    const { patient_name, doctor_name, medicine_name } = req.body;

    await Prescription.create({
      patientName: patient_name,
      doctorName: doctor_name,
      medicineName: medicine_name,
      issuedDate: new Date(),
    });

    res.redirect('/');
  } catch (error) {
    console.error('Add prescription error:', error.message);
    res.redirect('/');
  }
});

router.post('/checkout', isAuthenticated, async (req, res) => {
  const { cart, total, paymentMethod, tendered } = req.body;
  const cashier = req.session.user || 'Cashier';
  const date = new Date().toLocaleString();
  const numericTotal = Number(total);

  if (!Array.isArray(cart) || !cart.length || !Number.isFinite(numericTotal) || numericTotal < 0) {
    return res.status(400).json({ success: false, message: 'Invalid checkout payload.' });
  }

  const vatAmount = numericTotal * 0.12;
  const vatableSales = numericTotal - vatAmount;
  const session = await mongoose.startSession();

  try {
    let saleRecord;
    let receiptDataObj;

    await session.withTransaction(async () => {
      for (const item of cart) {
        if (!mongoose.Types.ObjectId.isValid(item.id)) {
          throw new Error('Invalid product in cart.');
        }

        const product = await Product.findById(item.id).session(session);
        if (!product) {
          throw new Error(`Product not found: ${item.name || item.id}`);
        }

        const qty = Number(item.qty);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`Invalid quantity for ${product.name}.`);
        }

        if (product.stock < qty) {
          throw new Error(`Insufficient stock for ${product.name}.`);
        }
      }

      receiptDataObj = {
        saleId: 'TEMP',
        date,
        cashier,
        cart,
        total: numericTotal,
        vatableSales,
        vatAmount,
        paymentMethod,
        tendered: paymentMethod === 'Cash' ? Number(tendered) : numericTotal,
        change: paymentMethod === 'Cash' ? Number(tendered) - numericTotal : 0,
      };

      const [sale] = await Sale.create(
        [
          {
            total: numericTotal,
            cashier,
            paymentMethod: paymentMethod || 'Cash',
            tendered: receiptDataObj.tendered,
            change: receiptDataObj.change,
            vatableSales,
            vatAmount,
            cart: cart.map((item) => ({
              productId: item.id,
              name: item.name,
              qty: Number(item.qty),
              price: Number(item.price),
            })),
            receiptData: receiptDataObj,
            soldAt: new Date(),
          },
        ],
        { session }
      );

      saleRecord = sale;
      receiptDataObj.saleId = sale._id.toString();

      sale.receiptData = receiptDataObj;
      await sale.save({ session });

      for (const item of cart) {
        await Product.findByIdAndUpdate(
          item.id,
          { $inc: { stock: -Number(item.qty) } },
          { session }
        );
      }
    });

    res.json({
      success: true,
      saleId: saleRecord._id.toString(),
      receiptData: receiptDataObj,
    });
  } catch (error) {
    console.error('Checkout error:', error.message);
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
