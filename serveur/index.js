const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Augmenté pour les vocaux/photos
app.use(express.static(path.join(__dirname, '../client/build')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

// MEMOIRE VIVE
let utilisateurs = {}; // { pseudo: {id, key} }
let boiteAuxLettres = {}; // { pseudoDestinataire: [messages...] }

io.on('connection', (socket) => {
  console.log(`🔌 Connexion : ${socket.id}`);

  // 1. INSCRIPTION & RÉCUPÉRATION DES MESSAGES
  socket.on('register_pseudo', ({ pseudo, pubKey }) => {
    const cleanPseudo = pseudo.trim().toLowerCase();
    
    // Protection anti-vol de pseudo (sauf si c'est la même clé)
    if (utilisateurs[cleanPseudo] && utilisateurs[cleanPseudo].key !== pubKey) {
      socket.emit('register_error', "Pseudo déjà pris !");
      return;
    }

    utilisateurs[cleanPseudo] = { id: socket.id, key: pubKey };
    socket.monPseudo = cleanPseudo;
    socket.emit('register_success', cleanPseudo);

    // 📬 LE FACTEUR PASSE : On vérifie s'il a du courrier en attente
    if (boiteAuxLettres[cleanPseudo] && boiteAuxLettres[cleanPseudo].length > 0) {
      console.log(`📬 Livraison de ${boiteAuxLettres[cleanPseudo].length} messages pour ${cleanPseudo}`);
      boiteAuxLettres[cleanPseudo].forEach(paquet => {
        socket.emit('receive_private', paquet);
      });
      delete boiteAuxLettres[cleanPseudo]; // On vide la boîte
    }
  });

  // 2. DEMANDE D'AMI
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
      // Si pas là, on dit introuvable (on ne peut pas inviter un fantôme)
      socket.emit('ami_introuvable', cleanCible);
    }
  });

  // 3. MESSAGES (Avec stockage si absent)
  socket.on('private_message', (paquet) => {
    const destPseudo = paquet.destinatairePseudo;
    const destSocket = utilisateurs[destPseudo];

    const messageAEnvoyer = {
        emetteurPseudo: socket.monPseudo,
        messageChiffre: paquet.messageChiffre,
        nonce: paquet.nonce,
        emetteurKey: paquet.emetteurKey,
        timestamp: Date.now()
    };

    if (destSocket) {
      // Il est en ligne : Livraison directe
      io.to(destSocket.id).emit('receive_private', messageAEnvoyer);
    } else {
      // Il est hors ligne : On stocke dans la boîte aux lettres
      if (!boiteAuxLettres[destPseudo]) boiteAuxLettres[destPseudo] = [];
      boiteAuxLettres[destPseudo].push(messageAEnvoyer);
      console.log(`zzz Message stocké pour ${destPseudo} (Absent)`);
    }
  });

  // 4. TYPING
  socket.on('typing_event', ({ destinatairePseudo, isTyping }) => {
    const dest = utilisateurs[destinatairePseudo];
    if (dest) io.to(dest.id).emit('remote_typing', { pseudo: socket.monPseudo, isTyping });
  });

  socket.on('disconnect', () => {
    if (socket.monPseudo) {
        // On ne supprime PAS l'utilisateur de la mémoire pour qu'il puisse recevoir des messages hors ligne
        // On supprime juste son Socket ID pour savoir qu'il est déconnecté
        if(utilisateurs[socket.monPseudo]) delete utilisateurs[socket.monPseudo].id;
    }
  });
});

// Route de secours
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`>>> ✅ GHOST SERVER V3 (Mailbox) PRÊT (${PORT}) <<<`));