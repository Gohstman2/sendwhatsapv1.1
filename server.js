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

const GITHUB_TOKEN = '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'; // Mets ton token ici (idéalement variable d'env)
const GIST_ID = '1b1826e87cc3fa6f70157ba06aa2caa6'; // Ton ID de Gist
const SESSION_FILE = 'session.json';
const sessionPath = path.resolve(__dirname, SESSION_FILE);

let qrCodeBase64 = null;
let authenticated = false;

// Télécharger session depuis le Gist GitHub
async function downloadSession() {
  try {
    const response = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    const files = response.data.files;
    if (!files[SESSION_FILE]) {
      console.log('🟡 Pas de session dans le Gist');
      return null;
    }

    const content = files[SESSION_FILE].content;
    await fs.writeFile(sessionPath, content);
    console.log('✅ Session téléchargée depuis Gist');
    return JSON.parse(content);
  } catch (err) {
    console.error('❌ Erreur downloadSession:', err.message);
    return null;
  }
}

// Upload session vers le Gist GitHub
async function uploadSession(session) {
  try {
    const content = JSON.stringify(session);
    await fs.writeFile(sessionPath, content);

    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: {
        [SESSION_FILE]: {
          content: content
        }
      }
    }, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    console.log('✅ Session sauvegardée sur Gist');
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
    if (authenticated) {
      res.json({ status: 'authenticated' });
    } else {
      res.json({ status: 'not authenticated' });
    }
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
