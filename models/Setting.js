const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    value: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'settings',
  }
);

module.exports = mongoose.model('Setting', settingSchema);
