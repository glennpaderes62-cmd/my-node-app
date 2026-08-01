function docId(doc) {
  return doc._id ? doc._id.toString() : doc.id;
}

function toLegacyProduct(doc) {
  const plain = doc.toObject ? doc.toObject() : doc;
  return {
    id: docId(plain),
    name: plain.name,
    sku: plain.sku || '',
    barcode: plain.barcode || '',
    description: plain.description || '',
    category: plain.category || 'General',
    cost: Number(plain.cost) || 0,
    price: Number(plain.price) || 0,
    stock: Number(plain.stock) || 0,
    batch_no: plain.batchNo || '',
    expiry_date: plain.expiryDate || '',
    requires_prescription: plain.requiresPrescription ? 1 : 0,
  };
}

function toLegacyPrescription(doc) {
  const plain = doc.toObject ? doc.toObject() : doc;
  const dateValue = plain.issuedDate || plain.createdAt;
  return {
    id: docId(plain),
    patient_name: plain.patientName,
    doctor_name: plain.doctorName,
    medicine_name: plain.medicineName,
    date: dateValue ? new Date(dateValue).toLocaleDateString() : '',
  };
}

function toLegacySale(doc) {
  const plain = doc.toObject ? doc.toObject() : doc;
  const receiptData = plain.receiptData || {};
  const date =
    receiptData.date ||
    (plain.soldAt ? new Date(plain.soldAt).toLocaleString() : '');

  return {
    id: docId(plain),
    total: Number(plain.total) || 0,
    cashier: plain.cashier || '',
    date,
    receipt_data: JSON.stringify(receiptData),
  };
}

function toLegacyUser(doc) {
  const plain = doc.toObject ? doc.toObject() : doc;
  return {
    id: docId(plain),
    username: plain.username,
    password: plain.password,
    role: plain.role,
  };
}

module.exports = {
  toLegacyProduct,
  toLegacyPrescription,
  toLegacySale,
  toLegacyUser,
};
