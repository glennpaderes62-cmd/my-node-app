const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    name: String,
    qty: {
      type: Number,
      min: 1,
    },
    price: {
      type: Number,
      min: 0,
    },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    cashier: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Card', 'GCash', 'Other'],
      default: 'Cash',
    },
    tendered: {
      type: Number,
      min: 0,
    },
    change: {
      type: Number,
      min: 0,
      default: 0,
    },
    vatableSales: {
      type: Number,
      min: 0,
      default: 0,
    },
    vatAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    cart: {
      type: [saleItemSchema],
      default: [],
    },
    receiptData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    branch: {
      type: String,
      trim: true,
      default: 'Main',
      index: true,
    },
    soldAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'sales',
  }
);

module.exports = mongoose.model('Sale', saleSchema);
