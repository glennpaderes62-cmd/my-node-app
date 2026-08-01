const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema(
  {
    patientName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    doctorName: {
      type: String,
      required: true,
      trim: true,
    },
    medicineName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    issuedDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'prescriptions',
  }
);

module.exports = mongoose.model('Prescription', prescriptionSchema);
