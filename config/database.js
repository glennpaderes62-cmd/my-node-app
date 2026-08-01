const mongoose = require('mongoose');

const MAX_RETRIES = Number(process.env.MONGO_CONNECT_RETRIES) || 10;
const RETRY_DELAY_MS = Number(process.env.MONGO_RETRY_DELAY_MS) || 5000;

let reconnectTimer = null;
let listenersAttached = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConnectionOptions() {
  return {
    dbName: process.env.MONGO_DB_NAME || 'pharmacy',

    maxPoolSize: 50,
    minPoolSize: 5,

    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,

    retryWrites: true,
    w: 'majority',
  };
}

function attachConnectionListeners() {
  if (listenersAttached) return;

  listenersAttached = true;

  mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
    scheduleBackgroundReconnect();
  });
}


async function connectDB() {

  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('❌ MONGO_URI is missing in .env file');
    return null;
  }


  attachConnectionListeners();


  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }


  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {

    try {

      console.log(`MongoDB connection attempt ${attempt}/${MAX_RETRIES}`);

      await mongoose.connect(uri, {
        dbName: 'pharmacy',
        serverSelectionTimeoutMS: 15000,
        retryWrites: true,
        w: 'majority'
      });


      console.log('✅ MongoDB connection established');

      return mongoose.connection;


    } catch (error) {

      console.error(
        `❌ MongoDB connection failed: ${error.message}`
      );


      if (attempt < MAX_RETRIES) {

        console.log(
          `Retrying in ${RETRY_DELAY_MS / 1000} seconds...`
        );

        await sleep(RETRY_DELAY_MS);

      }

    }
  }


  console.log(
    '⚠️ MongoDB unavailable. Running without database temporarily.'
  );

  return null;
}



function scheduleBackgroundReconnect() {

  if (reconnectTimer) return;


  reconnectTimer = setTimeout(async () => {

    reconnectTimer = null;


    if (mongoose.connection.readyState === 1) {
      return;
    }


    try {

      await connectDB();

      console.log(
        '✅ Background MongoDB reconnect successful'
      );


    } catch(error) {

      console.error(
        '❌ Background reconnect failed:',
        error.message
      );

      scheduleBackgroundReconnect();

    }


  }, RETRY_DELAY_MS);

}



function isConnected() {
  return mongoose.connection.readyState === 1;
}


module.exports = connectDB;
module.exports.scheduleBackgroundReconnect = scheduleBackgroundReconnect;
module.exports.isConnected = isConnected;