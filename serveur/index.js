const express = require('express');
const Gun = require('gun'); // Le moteur P2P
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// On sert le site web (React)
app.use(express.static(path.join(__dirname, '../client/build')));

const PORT = process.env.PORT || 3001;

// 1. On démarre le serveur HTTP
const server = app.listen(PORT, () => {
  console.log(`>>> 🔗 NŒUD GUN (BLOCKCHAIN) PRÊT SUR LE PORT ${PORT} <<<`);
});

// 2. On greffe Gun dessus (C'est ça qui crée la route /gun)
Gun({ web: server });