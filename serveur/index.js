const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../client/build')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

let utilisateurs = {};

io.on('connection', (socket) => {
  console.log(`🔌 Connexion : ${socket.id}`);

  socket.on('register_pseudo', ({ pseudo, pubKey }) => {
    const cleanPseudo = pseudo.trim().toLowerCase();
    if (utilisateurs[cleanPseudo] && utilisateurs[cleanPseudo].key !== pubKey) {
      socket.emit('register_error', "Pseudo pris !");
      return;
    }
    utilisateurs[cleanPseudo] = { id: socket.id, key: pubKey };
    socket.monPseudo = cleanPseudo;
    socket.emit('register_success', cleanPseudo);
  });

  socket.on('demande_connexion', (pseudoCible) => {
    const cleanCible = pseudoCible.trim().toLowerCase();
    const cible = utilisateurs[cleanCible];
    if (cible) {
      socket.emit('ami_trouve', { pseudo: cleanCible, key: cible.key });
      const monInfo = utilisateurs[socket.monPseudo];
      io.to(cible.id).emit('reception_invitation', { 
        pseudoAppelant: socket.monPseudo,
        cleAppelant: monInfo.key 
      });
    } else {
      socket.emit('ami_introuvable', cleanCible);
    }
  });

  socket.on('private_message', (paquet) => {
    const dest = utilisateurs[paquet.destinatairePseudo];
    if (dest) {
      io.to(dest.id).emit('receive_private', {
        emetteurPseudo: socket.monPseudo,
        messageChiffre: paquet.messageChiffre,
        nonce: paquet.nonce,
        emetteurKey: paquet.emetteurKey
      });
    }
  });

  socket.on('typing_event', ({ destinatairePseudo, isTyping }) => {
    const dest = utilisateurs[destinatairePseudo];
    if (dest) io.to(dest.id).emit('remote_typing', { pseudo: socket.monPseudo, isTyping });
  });

  socket.on('disconnect', () => {
    if (socket.monPseudo) delete utilisateurs[socket.monPseudo];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`>>> ✅ GHOST SERVER PRÊT (${PORT}) <<<`));