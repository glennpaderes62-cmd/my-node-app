const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    code: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'branches' }
);

module.exports = mongoose.model('Branch', branchSchema);
