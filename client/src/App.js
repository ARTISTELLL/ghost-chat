import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import "./App.css";

const socket = io();

function App() {
  const [screen, setScreen] = useState(0); 
  const [mesCles, setMesCles] = useState(null);
  const [monPseudo, setMonPseudo] = useState("");
  const [chats, setChats] = useState({});
  const [activeContact, setActiveContact] = useState(null); 
  const [inputAmi, setInputAmi] = useState(""); 
  const [message, setMessage] = useState("");
  const [invitation, setInvitation] = useState(null);
  const [typingInfo, setTypingInfo] = useState({}); 

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    const keys = nacl.box.keyPair();
    setMesCles(keys);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeContact, typingInfo]);

  useEffect(() => {
    if (!mesCles) return;

    socket.on('register_success', (p) => { setMonPseudo(p); setScreen(1); });
    socket.on('register_error', (m) => alert(m));
    
    socket.on('ami_trouve', (data) => {
      addContact(data.pseudo, data.key);
      openChat(data.pseudo); 
    });
    
    socket.on('ami_introuvable', (p) => alert(`@${p} est introuvable.`));

    socket.on('reception_invitation', (data) => {
      setInvitation({ pseudo: data.pseudoAppelant, key: data.cleAppelant });
    });

    socket.on('receive_private', (data) => {
      try {
        const sender = data.emetteurPseudo;
        const cleEmetteur = decodeBase64(data.emetteurKey);

        const messageDechiffre = nacl.box.open(
          decodeBase64(data.messageChiffre),
          decodeBase64(data.nonce),
          cleEmetteur,
          mesCles.secretKey
        );

        if (messageDechiffre) {
          const texte = new TextDecoder("utf-8").decode(messageDechiffre);
          const isImg = texte.startsWith("data:image");
          
          setChats(prevChats => {
            const existingChat = prevChats[sender] || { key: data.emetteurKey, messages: [], unread: 0 };
            const isWatching = (activeContact === sender && screen === 2);
            
            return {
              ...prevChats,
              [sender]: {
                ...existingChat,
                key: data.emetteurKey,
                messages: [...existingChat.messages, { text: texte, isMe: false, isImage: isImg }],
                unread: isWatching ? 0 : existingChat.unread + 1
              }
            };
          });
          setTypingInfo(prev => ({ ...prev, [sender]: false }));
        }
      } catch (e) { console.error(e); }
    });

    socket.on('remote_typing', (data) => {
      setTypingInfo(prev => ({ ...prev, [data.pseudo]: data.isTyping }));
    });

    return () => {
      socket.off('register_success');
      socket.off('register_error');
      socket.off('ami_trouve');
      socket.off('ami_introuvable');
      socket.off('reception_invitation');
      socket.off('receive_private');
      socket.off('remote_typing');
    };
  }, [mesCles, activeContact, screen]);

  const addContact = (pseudo, key) => {
    setChats(prev => {
      if (prev[pseudo]) return prev;
      return { ...prev, [pseudo]: { key, messages: [], unread: 0 } };
    });
  };

  const openChat = (pseudo) => {
    setActiveContact(pseudo);
    setScreen(2);
    setChats(prev => ({ ...prev, [pseudo]: { ...prev[pseudo], unread: 0 } }));
  };

  const backToDashboard = () => {
    setScreen(1);
    setActiveContact(null);
  };

  const login = () => {
    if (monPseudo.length > 2) socket.emit('register_pseudo', { pseudo: monPseudo, pubKey: encodeBase64(mesCles.publicKey) });
  };

  const lancerRecherche = () => {
    if (inputAmi) socket.emit('demande_connexion', inputAmi);
  };

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
      const box = nacl.box(
        new TextEncoder("utf-8").encode(contenu),
        nonce,
        clePubDest,
        mesCles.secretKey
      );
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
          messages: [...prev[activeContact].messages, { text: message, isMe: true, isImage: false }]
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
            messages: [...prev[activeContact].messages, { text: reader.result, isMe: true, isImage: true }]
          }
        }));
      };
      reader.readAsDataURL(file);
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
      <div className="header">GHOST CHAT 👻</div>

      {invitation && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>📞 Appel Entrant</h3>
            <p><b>@{invitation.pseudo}</b> veut établir une liaison.</p>
            <div className="modal-buttons">
              <button className="btn-accept" onClick={accepterInvitation}>ACCEPTER</button>
              <button className="btn-deny" onClick={() => setInvitation(null)}>NON</button>
            </div>
          </div>
        </div>
      )}

      {screen === 0 && (
        <div className="menu-screen center">
          <h2>CONNEXION</h2>
          <div className="input-group"><span className="prefix">@</span><input className="input-login" placeholder="Pseudo" value={monPseudo} onChange={e => setMonPseudo(e.target.value)}/></div>
          <button className="btn-main" onClick={login}>ENTRER</button>
        </div>
      )}

      {screen === 1 && (
        <div className="menu-screen">
          <div className="card"><h3>Identité</h3><div className="identity-badge">@{monPseudo}</div></div>
          <div className="card">
            <h3>Nouvelle Liaison</h3>
            <div style={{display:'flex', gap:'10px'}}>
                <input className="input-friend" placeholder="Pseudo..." value={inputAmi} onChange={e => setInputAmi(e.target.value)}/>
                <button className="btn-go" style={{width:'auto', padding:'0 20px'}} onClick={lancerRecherche}>+</button>
            </div>
          </div>

          <div className="chat-list-container">
            <h3 style={{marginLeft: '10px', opacity: 0.7}}>MESSAGES</h3>
            {sortedContacts.length === 0 && (
              <div style={{textAlign:'center', marginTop:'50px', color:'#444'}}>
                <div style={{fontSize:'40px', marginBottom:'10px'}}>📭</div>
                Aucune conversation active
              </div>
            )}
            {sortedContacts.map(pseudo => (
              <div key={pseudo} className="contact-row" onClick={() => openChat(pseudo)}>
                <div className="contact-avatar">{pseudo.substring(0,2).toUpperCase()}</div>
                <div className="contact-details">
                    <span className="contact-name">@{pseudo}</span>
                    <span className="contact-lastmsg">
                        {typingInfo[pseudo] ? <span style={{color:'#00f2ea'}}>écrit...</span> : 
                         chats[pseudo].messages.length > 0 ? 
                         (chats[pseudo].messages[chats[pseudo].messages.length-1].isImage ? "📸 Photo" : chats[pseudo].messages[chats[pseudo].messages.length-1].text) 
                         : "Nouvelle connexion"}
                    </span>
                </div>
                {chats[pseudo].unread > 0 && <div className="unread-badge">{chats[pseudo].unread}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {screen === 2 && activeContact && (
        <>
          {/* LE BOUTON RETOUR EST SORTI DU DIV BLOQUANT */}
          <button className="btn-back" onClick={backToDashboard}>⬅</button>
          
          <div className="chat-info">
            <span>@{activeContact}</span>
          </div>
          
          <div className="chat-box">
            {chats[activeContact].messages.map((msg, i) => (
              <div key={i} className={msg.isMe ? "msg-me" : "msg-other"}>
                <div className="bubble">
                  {msg.isImage ? (
                    <div className="secret-image-container"><img src={msg.text} alt="Secret" className="secret-img" onClick={(e) => e.target.classList.toggle('revealed')}/><span className="secret-label">📸 PHOTO</span></div>
                  ) : msg.text}
                </div>
              </div>
            ))}
            {typingInfo[activeContact] && <div className="msg-other"><div className="bubble typing-bubble"><span className="dot">.</span><span className="dot">.</span><span className="dot">.</span></div></div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            <input type="file" accept="image/*" ref={fileInputRef} style={{display:'none'}} onChange={choisirImage}/>
            <button className="btn-cam" onClick={() => fileInputRef.current.click()}>📷</button>
            <input value={message} onChange={handleTyping} placeholder="Message..." />
            <button onClick={envoyerTexte}>➤</button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
