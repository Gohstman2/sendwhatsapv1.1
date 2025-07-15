const express = require('express');
const { Client } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const SESSION_FILE = 'session.json';
const sessionPath = path.resolve(__dirname, SESSION_FILE);
let qrCodeBase64 = null;
let authenticated = false;

// Télécharger session depuis ton propre serveur
async function downloadSession() {
  try {
    const response = await axios.get('https://sendfiles.pythonanywhere.com/download');
    const content = response.data;

    await fs.writeFile(sessionPath, JSON.stringify(content));
    console.log('✅ Session téléchargée depuis ton serveur');
    return content;
  } catch (err) {
    console.warn('🟡 Aucune session existante ou erreur de téléchargement');
    return null;
  }
}

// Uploader session vers ton propre serveur
async function uploadSession(session) {
  try {
    await fs.writeFile(sessionPath, JSON.stringify(session));

    await axios.post('https://sendfiles.pythonanywhere.com/upload', {
      filename: SESSION_FILE,
      content: session
    });

    console.log('✅ Session sauvegardée sur ton serveur');
  } catch (err) {
    console.error('❌ Erreur uploadSession:', err.message);
  }
}

(async () => {
  const existingSession = await downloadSession();

  const client = new Client({
    session: existingSession || undefined,
    puppeteer: { headless: true, args: ['--no-sandbox'] },
  });

  client.on('qr', async (qr) => {
    console.log('📲 QR généré');
    qrCodeBase64 = await QRCode.toDataURL(qr);
    authenticated = false;
  });

  client.on('authenticated', async (session) => {
    console.log('✅ Authentifié');
    authenticated = true;
    qrCodeBase64 = null;
    await uploadSession(session);
  });

  client.on('ready', () => {
    console.log('🤖 Client prêt');
    authenticated = true;
    qrCodeBase64 = null;
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Auth échouée', msg);
    authenticated = false;
  });

  client.initialize();

  // === ROUTES ===
  app.get('/auth', (req, res) => {
    if (authenticated) {
      return res.json({ status: 'authenticated' });
    } else if (qrCodeBase64) {
      return res.json({ status: 'scan me', qr: qrCodeBase64 });
    } else {
      return res.json({ status: 'waiting for qr...' });
    }
  });

  app.get('/checkAuth', (req, res) => {
    return res.json({ status: authenticated ? 'authenticated' : 'not authenticated' });
  });

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

  app.listen(port, () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${port}`);
  });
})();
