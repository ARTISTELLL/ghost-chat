import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import QRCode from "react-qr-code";
import QrScanner from "react-qr-scanner";
import "./App.css";

const socket = io();

function App() {
  const [screen, setScreen] = useState(0); 
  
  // SÉCURITÉ
  const [mesCles, setMesCles] = useState(null);
  const [monPseudo, setMonPseudo] = useState("");
  const [maPub, setMaPub] = useState("");

  // CHATS
  const [chats, setChats] = useState({});
  const [activeContact, setActiveContact] = useState(null); 

  // UI
  const [inputAmi, setInputAmi] = useState(""); 
  const [message, setMessage] = useState("");
  const [invitation, setInvitation] = useState(null);
  const [typingInfo, setTypingInfo] = useState({}); 
  const [showQR, setShowQR] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // --- LES RÉFÉRENCES (C'est ici que j'avais oublié une ligne !) ---
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const typingTimeoutRef = useRef(null); // <--- LA LIGNE MANQUANTE EST LÀ

  // 1. CHARGEMENT IDENTITÉ
  useEffect(() => {
    const savedKeys = localStorage.getItem("ghost_keys");
    const savedPseudo = localStorage.getItem("ghost_pseudo");
    const savedChats = localStorage.getItem("ghost_chats");

    if (savedKeys && savedPseudo) {
      const keysParsed = JSON.parse(savedKeys);
      const keys = {
          publicKey: new Uint8Array(Object.values(keysParsed.publicKey)),
          secretKey: new Uint8Array(Object.values(keysParsed.secretKey))
      };
      setMesCles(keys);
      setMonPseudo(savedPseudo);
      setMaPub(encodeBase64(keys.publicKey));
      if (savedChats) setChats(JSON.parse(savedChats));
      
      socket.emit('register_pseudo', { pseudo: savedPseudo, pubKey: encodeBase64(keys.publicKey) });
      setScreen(1);
    } else {
      const keys = nacl.box.keyPair();
      setMesCles(keys);
      setMaPub(encodeBase64(keys.publicKey));
    }
  }, []);

  useEffect(() => {
    if (Object.keys(chats).length > 0) localStorage.setItem("ghost_chats", JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeContact, typingInfo]);

  // 2. GESTION RÉSEAU
  useEffect(() => {
    if (!mesCles) return;

    socket.on('register_success', (p) => { 
      setMonPseudo(p); setScreen(1);
      localStorage.setItem("ghost_pseudo", p);
      localStorage.setItem("ghost_keys", JSON.stringify(mesCles));
    });

    socket.on('register_error', (m) => alert(m));
    
    socket.on('ami_trouve', (data) => {
      addContact(data.pseudo, data.key);
      openChat(data.pseudo); 
      setScanMode(false);
    });
    
    socket.on('ami_introuvable', (p) => alert(`Utilisateur @${p} introuvable.`));

    socket.on('reception_invitation', (data) => {
      setInvitation({ pseudo: data.pseudoAppelant, key: data.cleAppelant });
    });

    socket.on('receive_private', (data) => {
      try {
        const sender = data.emetteurPseudo;
        const cleEmetteur = decodeBase64(data.emetteurKey);
        const messageDechiffre = nacl.box.open(decodeBase64(data.messageChiffre), decodeBase64(data.nonce), cleEmetteur, mesCles.secretKey);

        if (messageDechiffre) {
          const texte = new TextDecoder("utf-8").decode(messageDechiffre);
          const isImg = texte.startsWith("data:image");
          const isAudio = texte.startsWith("data:audio");
          
          setChats(prev => {
            const current = prev[sender] || { key: data.emetteurKey, messages: [], unread: 0 };
            const isWatching = (activeContact === sender && screen === 2);
            return {
              ...prev,
              [sender]: {
                ...current,
                key: data.emetteurKey,
                messages: [...current.messages, { text: texte, isMe: false, isImage: isImg, isAudio: isAudio, time: Date.now() }],
                unread: isWatching ? 0 : current.unread + 1
              }
            };
          });
          new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(e=>{});
        }
      } catch (e) { console.error(e); }
    });

    socket.on('remote_typing', (data) => {
      setTypingInfo(prev => ({ ...prev, [data.pseudo]: data.isTyping }));
    });

    return () => {
      socket.off('register_success'); socket.off('register_error'); socket.off('ami_trouve');
      socket.off('ami_introuvable'); socket.off('reception_invitation'); socket.off('receive_private');
      socket.off('remote_typing');
    };
  }, [mesCles, activeContact, screen]);

  // --- FONCTIONS ---

  const addContact = (pseudo, key) => {
    setChats(prev => ({ ...prev, [pseudo]: prev[pseudo] ? { ...prev[pseudo], key } : { key, messages: [], unread: 0 } }));
  };

  const openChat = (pseudo) => {
    setActiveContact(pseudo);
    setScreen(2);
    setChats(prev => ({ ...prev, [pseudo]: { ...prev[pseudo], unread: 0 } }));
  };

  const login = () => { if (monPseudo.length > 2) socket.emit('register_pseudo', { pseudo: monPseudo, pubKey: encodeBase64(mesCles.publicKey) }); };
  
  const lancerRecherche = () => { 
      if (inputAmi) socket.emit('demande_connexion', inputAmi.trim());
  };

  const handleScan = (data) => {
    if (data) {
        const scannedPseudo = data.text;
        if(scannedPseudo && scannedPseudo !== monPseudo) {
            socket.emit('demande_connexion', scannedPseudo);
            setScanMode(false);
        }
    }
  };
  const handleError = (err) => { console.error(err); };

  const accepterInvitation = () => {
    if (invitation) {
      addContact(invitation.pseudo, invitation.key);
      openChat(invitation.pseudo);
      setInvitation(null);
    }
  };

  const crypterEtEnvoyer = (contenu) => {
    const chatActuel = chats[activeContact];
    if (chatActuel && mesCles) {
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const clePubDest = decodeBase64(chatActuel.key);
      const box = nacl.box(new TextEncoder("utf-8").encode(contenu), nonce, clePubDest, mesCles.secretKey);
      socket.emit('private_message', {
        destinatairePseudo: activeContact,
        messageChiffre: encodeBase64(box),
        nonce: encodeBase64(nonce),
        emetteurKey: encodeBase64(mesCles.publicKey)
      });
    }
  };

  const envoyerTexte = () => {
    if (message.trim()) {
      crypterEtEnvoyer(message);
      setChats(prev => ({
        ...prev,
        [activeContact]: {
          ...prev[activeContact],
          messages: [...prev[activeContact].messages, { text: message, isMe: true, isImage: false, isAudio: false, time: Date.now() }]
        }
      }));
      setMessage("");
    }
  };

  const choisirImage = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        crypterEtEnvoyer(reader.result);
        setChats(prev => ({
          ...prev,
          [activeContact]: {
            ...prev[activeContact],
            messages: [...prev[activeContact].messages, { text: reader.result, isMe: true, isImage: true, isAudio: false, time: Date.now() }]
          }
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
        if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
        setIsRecording(false);
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];
            mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
            mediaRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    crypterEtEnvoyer(reader.result);
                    setChats(prev => ({
                        ...prev,
                        [activeContact]: {
                        ...prev[activeContact],
                        messages: [...prev[activeContact].messages, { text: reader.result, isMe: true, isImage: false, isAudio: true, time: Date.now() }]
                        }
                    }));
                };
            };
            mediaRecorderRef.current.start();
            setIsRecording(true);
        } catch (err) { alert("Micro non autorisé"); }
    }
  };

  const handleTyping = (e) => {
    setMessage(e.target.value);
    socket.emit('typing_event', { destinatairePseudo: activeContact, isTyping: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing_event', { destinatairePseudo: activeContact, isTyping: false });
    }, 2000);
  };

  const sortedContacts = Object.keys(chats).sort((a,b) => chats[b].unread - chats[a].unread);

  return (
    <div className="app-container">
      <div className="header">
        <div className="brand">GST <span style={{fontWeight:'300'}}>SECURE</span></div>
      </div>

      {invitation && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>📞 Liaison Entrante</h3>
            <p><b>@{invitation.pseudo}</b> veut se connecter.</p>
            <div className="modal-buttons">
              <button className="btn-luxe" onClick={accepterInvitation}>ACCEPTER</button>
              <button className="btn-deny" onClick={() => setInvitation(null)}>REFUSER</button>
            </div>
          </div>
        </div>
      )}

      {screen === 0 && (
        <div className="auth-screen">
          <div className="auth-card">
            <h2>GST LOGIN</h2>
            <p className="subtitle">Réseau Cryptographique Privé</p>
            <input className="input-luxe" placeholder="Identifiant" value={monPseudo} onChange={e => setMonPseudo(e.target.value)}/>
            <button className="btn-luxe" onClick={login}>CONNEXION SECURE</button>
          </div>
        </div>
      )}

      {screen === 1 && (
        <div className="dashboard">
          <div className="identity-card">
            <div className="user-info" onClick={() => setShowQR(!showQR)}>
              <div className="avatar-large">{monPseudo.substring(0,1).toUpperCase()}</div>
              <div style={{overflow:'hidden'}}>
                <h3>@{monPseudo}</h3>
                <p className="token-display">KEY: {maPub.substring(0, 10)}...</p>
                <span className="status">● Blockchain Node Active</span>
              </div>
            </div>
            {showQR && (
              <div className="qr-container">
                <QRCode value={monPseudo} size={150} bgColor="#fdfbf7" fgColor="#333" />
                <p>Scan pour ajouter @{monPseudo}</p>
              </div>
            )}
          </div>

          {scanMode ? (
              <div className="scanner-zone" style={{padding:'20px'}}>
                  <QrScanner delay={300} onError={handleError} onScan={handleScan} style={{ width: '100%', borderRadius:'10px' }} />
                  <button className="btn-deny" style={{marginTop:'10px', width:'100%'}} onClick={() => setScanMode(false)}>FERMER SCANNER</button>
              </div>
          ) : (
            <div className="add-contact-section">
                <input className="input-minimal" placeholder="Recherche pseudo..." value={inputAmi} onChange={e => setInputAmi(e.target.value)}/>
                <button className="btn-icon" onClick={lancerRecherche}>+</button>
                <button className="btn-icon" onClick={() => setScanMode(true)}>📷</button>
            </div>
          )}

          <div className="contacts-list">
            {sortedContacts.length === 0 && <div className="empty-state">Aucune liaison active</div>}
            {sortedContacts.map(pseudo => (
              <div key={pseudo} className="contact-item" onClick={() => { setActiveContact(pseudo); setScreen(2); }}>
                <div className="contact-avatar">{pseudo.substring(0,1).toUpperCase()}</div>
                <div className="contact-info">
                  <span className="name">{pseudo}</span>
                  <span className="last-msg">
                    {chats[pseudo].messages.length > 0 ? 
                      (chats[pseudo].messages[chats[pseudo].messages.length-1].isAudio ? "🎵 Vocal Sécurisé" : 
                       chats[pseudo].messages[chats[pseudo].messages.length-1].isImage ? "📷 Photo Chiffrée" : "Message Chiffré") 
                      : "Canal établi"}
                  </span>
                </div>
                {chats[pseudo].unread > 0 && <div className="badge">{chats[pseudo].unread}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {screen === 2 && activeContact && (
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
            
            <input className="msg-input" value={message} onChange={handleTyping} placeholder="Message..." />
            
            <button 
              className={`btn-tool ${isRecording ? "recording" : ""}`} 
              onClick={toggleRecording}
            >
              {isRecording ? "🛑" : "🎙️"}
            </button>
            
            <button className="btn-send" onClick={() => envoyerTexte()}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
