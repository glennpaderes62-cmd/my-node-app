const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('./config/database');
const { scheduleBackgroundReconnect } = require('./config/database');

const seedDefaults = require('./config/seed');
const maintenanceGuard = require('./middleware/maintenance');
const registerRoutes = require('./routes');

const app = express();

const PORT = process.env.PORT || 4080;


const allowedOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);


app.use(
  cors({
    origin(origin, callback) {

      if (
        !origin ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },

    credentials: true,
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With'
    ],

    maxAge: 86400
  })
);


app.use(express.json({
  limit: process.env.JSON_LIMIT || '10mb'
}));

app.use(express.urlencoded({
  extended: true,
  limit: process.env.JSON_LIMIT || '10mb'
}));


app.disable('x-powered-by');


app.set('view engine','ejs');

app.set(
  'views',
  path.join(__dirname,'views')
);


app.use(
  express.static(
    path.join(__dirname,'public')
  )
);



app.use(
  session({

    secret:
      process.env.SESSION_SECRET ||
      'rxpos_secure_secret_key',

    resave: false,

    saveUninitialized: false,

cookie:{
  secure: true,
  httpOnly: true,
  sameSite: 'none',
  maxAge: 24 * 60 * 60 * 1000
}

  })
);


app.use(maintenanceGuard);



app.get('/health',(req,res)=>{

  const states=[
    'disconnected',
    'connected',
    'connecting',
    'disconnecting'
  ];


  res.json({

    status:'ok',

    database:
      states[mongoose.connection.readyState],

    time:
      new Date()

  });

});



registerRoutes(app);



app.use((req,res)=>{

  res.status(404).json({

    success:false,

    message:'Route not found'

  });

});



app.use((err,req,res,next)=>{

  console.error(
    'Unhandled error:',
    err.message
  );


  res.status(500).json({

    success:false,

    message:err.message

  });

});





async function startServer(){


  const connection =
    await connectDB();



  app.listen(PORT,()=>{

    console.log(
      `RxPOS server running at http://localhost:${PORT}`
    );

  });



  if(connection){

    try{

      await seedDefaults();

    }catch(error){

      console.error(
        'Seed error:',
        error.message
      );

    }


  }else{


    scheduleBackgroundReconnect();


  }

}





process.on(
  'SIGINT',
  async()=>{

    await mongoose.connection.close();

    process.exit(0);

  }
);



process.on(
  'SIGTERM',
  async()=>{

    await mongoose.connection.close();

    process.exit(0);

  }
);



startServer();