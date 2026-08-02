const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    sku: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    barcode: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      default: 'General',
      index: true,
    },
    cost: {
      type: Number,
      min: 0,
      default: 0,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      index: true,
    },
    batchNo: {
      type: String,
      trim: true,
      default: '',
    },
    expiryDate: {
      type: String,
      trim: true,
      default: '',
    },
    requiresPrescription: {
      type: Boolean,
      default: false,
      index: true,
    },
    branch: {
      type: String,
      trim: true,
      default: 'Main',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'products',
  }
);

productSchema.index({ name: 'text', description: 'text', sku: 'text' });

module.exports = mongoose.model('Product', productSchema);
