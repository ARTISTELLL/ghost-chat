import React, { useState, useEffect, useRef } from "react";
import Gun from "gun";
import SEA from "gun/sea";
import QRCode from "react-qr-code"; // Pour le badge agent
import "./App.css";

// Configuration Gun (Hybride : Local + Relais)
const gun = Gun({
  peers: [
    window.location.origin + '/gun', 
    'https://gun-manhattan.herokuapp.com/gun'
  ],
  localStorage: true
});

const user = gun.user().recall({session: true});

function App() {
  const [screen, setScreen] = useState(0); 
  
  // INFOS
  const [monPseudo, setMonPseudo] = useState("");
  const [monPass, setMonPass] = useState("");
  const [maPub, setMaPub] = useState("");

  // CHATS
  const [chats, setChats] = useState({});
  const [activeContact, setActiveContact] = useState(null);
  const [activePub, setActivePub] = useState(null);

  // UI & MESSAGES
  const [inputAmi, setInputAmi] = useState(""); 
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [showQR, setShowQR] = useState(false); // Afficher mon QR
  const [isRecording, setIsRecording] = useState(false); // État enregistrement

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeContact]);

  // AUTHENTIFICATION & CHARGEMENT
  useEffect(() => {
    gun.on('auth', async () => {
      const alias = await user.get('alias');
      setMonPseudo(alias);
      setMaPub(user.is.pub);
      setScreen(1);
      chargerContacts();
    });
  }, []);

  const chargerContacts = () => {
    user.get('amis').map().on(async (friendPub, friendAlias) => {
      if (!friendPub) return;
      
      setChats(prev => ({
        ...prev,
        [friendAlias]: { pub: friendPub, messages: [], unread: 0 }
      }));

      const chatID = [user.is.pub, friendPub].sort().join('~');
      
      gun.get('chat-luxe-v1').get(chatID).map().on(async (data, id) => {
        const secret = await SEA.secret(friendPub, user._.sea);
        const msgDecrypted = await SEA.decrypt(data.msg, secret);
        
        if (msgDecrypted) {
          const isMe = data.auteur === user.is.pub;
          const isImg = msgDecrypted.startsWith("data:image");
          const isAudio = msgDecrypted.startsWith("data:audio");

          setChats(prev => {
            const currentChat = prev[friendAlias];
            if (currentChat.messages.find(m => m.id === id)) return prev;
            
            const isActive = (activeContact === friendAlias && screen === 2);
            return {
              ...prev,
              [friendAlias]: {
                ...currentChat,
                messages: [...currentChat.messages, { id, text: msgDecrypted, isMe, isImage: isImg, isAudio: isAudio, time: data.time }].sort((a,b) => a.time - b.time),
                unread: (isActive || isMe) ? 0 : currentChat.unread + 1
              }
            };
          });
        }
      });
    });
  };

  // --- ACTIONS ---

  const login = () => {
    setErreur("");
    user.create(monPseudo, monPass, (ack) => {
      if (ack.err && ack.err.includes("already")) {
        user.auth(monPseudo, monPass, (authAck) => {
          if (authAck.err) setErreur("Identifiants incorrects.");
        });
      } else if (ack.err) {
        setErreur(ack.err);
      } else {
        user.auth(monPseudo, monPass);
      }
    });
  };

  const ajouterAmi = () => {
    if (!inputAmi) return;
    gun.get(`~@${inputAmi}`).once(async (data) => {
      if (!data) return alert("Contact introuvable dans le registre.");
      const friendPub = Object.keys(data).find(k => k.includes('pub'));
      if(!friendPub) return alert("Erreur de clé.");
      
      user.get('amis').get(inputAmi).put(friendPub.replace('~', ''));
      alert(`Contact ${inputAmi} ajouté au carnet.`);
      setInputAmi("");
    });
  };

  // ENVOI MESSAGE (Texte, Image ou Audio)
  const envoyer = async (contenu) => {
    if (contenu && activePub) {
      const secret = await SEA.secret(activePub, user._.sea);
      const msgEncrypted = await SEA.encrypt(contenu, secret);
      const chatID = [user.is.pub, activePub].sort().join('~');
      
      gun.get('chat-luxe-v1').get(chatID).set({
        msg: msgEncrypted,
        auteur: user.is.pub,
        time: Date.now()
      });
      setMessage("");
    }
  };

  // GESTION AUDIO (MICRO)
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => envoyer(reader.result); // Envoi du Base64 audio
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("Accès micro refusé.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const choisirImage = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => envoyer(reader.result);
      reader.readAsDataURL(file);
    }
  };

  // RENDER
  const sortedContacts = Object.keys(chats).sort((a,b) => chats[b].unread - chats[a].unread);

  return (
    <div className="app-container">
      
      {/* HEADER LUXE */}
      <div className="header">
        <div className="brand">HERMES <span style={{fontWeight:'300'}}>SECURE</span></div>
      </div>

      {/* ECRAN LOGIN */}
      {screen === 0 && (
        <div className="auth-screen">
          <div className="auth-card">
            <h2>Bienvenue</h2>
            <p className="subtitle">Messagerie Privée & Souveraine</p>
            <input className="input-luxe" placeholder="Identifiant" value={monPseudo} onChange={e => setMonPseudo(e.target.value)}/>
            <input className="input-luxe" type="password" placeholder="Clé secrète" value={monPass} onChange={e => setMonPass(e.target.value)}/>
            {erreur && <div className="error-msg">{erreur}</div>}
            <button className="btn-luxe" onClick={login}>ACCÉDER</button>
          </div>
        </div>
      )}

      {/* DASHBOARD (LISTE) */}
      {screen === 1 && (
        <div className="dashboard">
          {/* CARTE D'IDENTITÉ AVEC QR CODE */}
          <div className="identity-card" onClick={() => setShowQR(!showQR)}>
            <div className="user-info">
              <div className="avatar-large">{monPseudo.substring(0,1).toUpperCase()}</div>
              <div>
                <h3>{monPseudo}</h3>
                <span className="status">● En ligne sécurisée</span>
              </div>
            </div>
            {showQR && (
              <div className="qr-container">
                <QRCode value={monPseudo} size={120} bgColor="#fdfbf7" fgColor="#333" />
                <p>Scannez pour ajouter</p>
              </div>
            )}
          </div>

          <div className="add-contact-section">
            <input className="input-minimal" placeholder="Ajouter un contact..." value={inputAmi} onChange={e => setInputAmi(e.target.value)}/>
            <button className="btn-icon" onClick={ajouterAmi}>+</button>
          </div>

          <div className="contacts-list">
            {sortedContacts.length === 0 && <div className="empty-state">Carnet d'adresses vide</div>}
            {sortedContacts.map(pseudo => (
              <div key={pseudo} className="contact-item" onClick={() => { setActiveContact(pseudo); setActivePub(chats[pseudo].pub); setScreen(2); }}>
                <div className="contact-avatar">{pseudo.substring(0,1).toUpperCase()}</div>
                <div className="contact-info">
                  <span className="name">{pseudo}</span>
                  <span className="last-msg">
                    {chats[pseudo].messages.length > 0 ? 
                      (chats[pseudo].messages[chats[pseudo].messages.length-1].isAudio ? "🎵 Message Vocal" : 
                       chats[pseudo].messages[chats[pseudo].messages.length-1].isImage ? "📷 Photo" : "Message chiffré") 
                      : "Nouvelle connexion"}
                  </span>
                </div>
                {chats[pseudo].unread > 0 && <div className="badge">{chats[pseudo].unread}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CHAT ROOM */}
      {screen === 2 && (
        <div className="chat-interface">
          <div className="chat-header">
            <button className="btn-back" onClick={() => {setScreen(1); setActiveContact(null);}}>←</button>
            <span className="chat-title">{activeContact}</span>
          </div>

          <div className="messages-area">
            {chats[activeContact].messages.map((msg, i) => (
              <div key={i} className={msg.isMe ? "msg-row me" : "msg-row other"}>
                <div className="message-bubble">
                  {msg.isImage ? (
                    <img src={msg.text} className="chat-img" alt="reçu" />
                  ) : msg.isAudio ? (
                    <audio controls src={msg.text} className="chat-audio" />
                  ) : (
                    msg.text
                  )}
                </div>
                <div className="msg-time">{new Date(msg.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-bar">
            <input type="file" ref={fileInputRef} style={{display:'none'}} onChange={choisirImage}/>
            <button className="btn-tool" onClick={() => fileInputRef.current.click()}>📷</button>
            
            <input className="msg-input" value={message} onChange={e => setMessage(e.target.value)} placeholder="Écrire..." />
            
            {/* BOUTON MICRO (Appui long simulé par Clic Début / Clic Fin pour simplifier sur mobile) */}
            <button 
              className={`btn-tool ${isRecording ? "recording" : ""}`} 
              onMouseDown={startRecording} 
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
            >
              {isRecording ? "🛑" : "🎙️"}
            </button>
            
            <button className="btn-send" onClick={() => envoyer(message)}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
