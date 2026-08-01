const { MongoClient } = require('mongodb');
const uri = "mongodb+srv://glennpaderes62_db_user:sxu9cBBudtZHPoAp@cluster0.5igwhji.mongodb.net/pharmacy?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    console.log("=== TAMA ANG CODE AT NETWORKING! CONNECTED NA TAYO! ===");
  } catch (err) {
    console.error("=== MAY MALI SA CONFIGURATION O NETWORK BLOCK: ===", err.message);
  } finally {
    await client.close();
  }
}
run();