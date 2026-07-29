const express = require('express');
const app = express();

// Babasahin nito ang port mula sa cloud, o mag-a-apply ng 3000 kung nasa local PC ka
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Hello World! Gumagana na ang aking Node.js app sa cloud!');
});

app.listen(port, () => {
  console.log(`Ang server ay tumatakbo sa port ${port}`);
});