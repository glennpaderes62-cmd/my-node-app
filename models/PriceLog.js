const mongoose = require('mongoose');

const priceLogSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    oldPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    newPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    changedBy: {
      type: String,
      trim: true,
      default: 'system',
    },
  },
  {
    timestamps: true,
    collection: 'price_logs',
  }
);

module.exports = mongoose.model('PriceLog', priceLogSchema);
