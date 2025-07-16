const express = require('express');
const { Client, LegacySessionAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let authenticated = false;

// 🔁 Charger session si existe
let sessionData = null;
try {
  sessionData = require('./session.json');
} catch (e) {
  console.log("Aucune session existante. QR requis.");
}

// 🚀 Client WhatsApp
const client = new Client({
  authStrategy: new LegacySessionAuth({
    session: sessionData,
  }),
  puppeteer: { headless: true, args: ['--no-sandbox'] },
});

// 📲 QR Code à scanner
client.on('qr', async (qr) => {
  console.log('📲 QR généré. Scannez pour vous connecter.');
  qrCodeBase64 = await QRCode.toDataURL(qr);
  authenticated = false;
});

// ✅ Auth réussie
client.on('authenticated', (session) => {
  console.log('✅ Authentifié. Session sauvegardée dans session.json');
  fs.writeFileSync('./session.json', JSON.stringify(session));
  qrCodeBase64 = null;
  authenticated = true;
});

// 🤖 Client prêt
client.on('ready', () => {
  console.log('🤖 Client WhatsApp prêt');
  authenticated = true;
  qrCodeBase64 = null;
});

// ❌ Auth échec
client.on('auth_failure', (msg) => {
  console.error('❌ Échec d’authentification :', msg);
  authenticated = false;
});

// 🔄 Initialiser client
client.initialize();

// === ROUTES ===

// 🔐 Route QR
app.get('/auth', (req, res) => {
  if (authenticated) {
    res.json({ status: 'authenticated' });
  } else if (qrCodeBase64) {
    res.json({ status: 'scan me', qr: qrCodeBase64 });
  } else {
    res.json({ status: 'waiting for qr...' });
  }
});

// 🔎 Vérifier auth
app.get('/checkAuth', (req, res) => {
  res.json({ status: authenticated ? 'authenticated' : 'not authenticated' });
});

// ✉️ Envoi de message
app.post('/sendMessage', async (req, res) => {
  const { number, message } = req.body;

  if (!authenticated) {
    return res.status(401).json({ error: 'Client non authentifié' });
  }

  if (!number || !message) {
    return res.status(400).json({ error: 'Numéro et message requis' });
  }

  const formatted = number.replace('+', '') + '@c.us';

  try {
    await client.sendMessage(formatted, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📥 Télécharger la session
app.get('/download-session', (req, res) => {
  const file = path.join(__dirname, 'session.json');
  if (fs.existsSync(file)) {
    res.download(file, 'session.json');
  } else {
    res.status(404).json({ error: 'Session non disponible' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${port}`);
});
