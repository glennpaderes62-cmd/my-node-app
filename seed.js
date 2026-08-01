const mongoose = require('mongoose');

// Gagamitin ang mismong link ng pharmacy database mo
const uri = 'mongodb+srv://glennpaderes62_db_user:sxu9cBBudtZHPoAp@cluster0.5igwhji.mongodb.net/pharmacy?retryWrites=true&w=majority&appName=Cluster0';

async function run() {
  try {
    await mongoose.connect(uri);
    console.log("Konektado na sa database...");

    const db = mongoose.connection.db;
    
    // Puwersahang isasaksak ang admin sa 'users' collection
    await db.collection('users').updateOne(
      { username: 'superadmin' },
      { 
        $set: { 
          username: 'superadmin', 
          password: 'admin123', 
          role: 'superadmin' 
        } 
      },
      { upsert: true }
    );

    console.log('=== SUCCESS: GAWA NA ANG ACCOUNT MO SA CLOUD! ===');
  } catch (error) {
    console.error('May problema:', error);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

run();