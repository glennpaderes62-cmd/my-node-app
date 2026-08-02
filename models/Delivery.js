const mongoose = require('mongoose');

const deliveryLineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    qty: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const deliverySchema = new mongoose.Schema(
  {
    receiptNo: { type: String, trim: true, required: true, index: true },
    lines: { type: [deliveryLineSchema], default: [] },
    createdBy: { type: String, trim: true, default: 'system' },
  },
  { timestamps: true, collection: 'deliveries' }
);

module.exports = mongoose.model('Delivery', deliverySchema);
