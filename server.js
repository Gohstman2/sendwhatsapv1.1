const express = require('express');
const { Client } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;
const SESSION_FILE = 'session.json';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const sessionPath = path.resolve(__dirname, SESSION_FILE);

let qrCodeBase64 = null;
let authenticated = false;

async function downloadSession() {
  try {
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .download(SESSION_FILE);

    if (error) {
      console.log('🟡 Pas de session sur Supabase');
      return null;
    }

    const buffer = await data.arrayBuffer();
    await fs.writeFile(sessionPath, Buffer.from(buffer));
    console.log('✅ Session téléchargée depuis Supabase');
    return JSON.parse(Buffer.from(buffer).toString());
  } catch (err) {
    console.error('❌ Erreur downloadSession:', err.message);
    return null;
  }
}

async function uploadSession(session) {
  try {
    await fs.writeFile(sessionPath, JSON.stringify(session));
    const file = await fs.readFile(sessionPath);

    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(SESSION_FILE, file, { upsert: true });

    if (error) {
      console.error('❌ Erreur uploadSession:', error.message);
    } else {
      console.log('✅ Session sauvegardée sur Supabase');
    }
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
