const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const clients = {}; // Stocke les clients par ID

// === ROUTES ===

// 🔐 Auth (création d’un nouveau client)
app.get('/auth', async (req, res) => {
  const id = uuidv4();

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id }),
    puppeteer: { headless: true, args: ['--no-sandbox'] },
  });

  clients[id] = {
    client,
    authenticated: false,
    qr: null,
    webhookUrl: null,
  };

  // Événements WhatsApp
  client.on('qr', async (qr) => {
    const qrCodeBase64 = await QRCode.toDataURL(qr);
    clients[id].qr = qrCodeBase64;
    clients[id].authenticated = false;
    console.log(`📲 QR généré pour ${id}`);
  });

  client.on('authenticated', () => {
    clients[id].authenticated = true;
    clients[id].qr = null;
    console.log(`✅ Authentifié : ${id}`);
  });

  client.on('ready', () => {
    clients[id].authenticated = true;
    clients[id].qr = null;
    console.log(`🤖 Prêt : ${id}`);
  });

  client.on('auth_failure', (msg) => {
    console.error(`❌ Auth échouée pour ${id}`, msg);
    clients[id].authenticated = false;
  });

  client.on('message', async (msg) => {
    const webhook = clients[id].webhookUrl;
    if (webhook) {
      try {
        await axios.post(webhook, {
          id,
          from: msg.from,
          body: msg.body,
          timestamp: msg.timestamp,
          type: msg.type,
        });
        console.log(`📤 Webhook envoyé pour ${id}`);
      } catch (err) {
        console.error(`❌ Échec Webhook pour ${id}:`, err.message);
      }
    }
  });

  client.initialize();

  // Attente QR (sera dispo via autre route)
  res.json({ id, status: 'waiting for qr' });
});

// 👁️ Récupérer QR code et statut
app.get('/auth/:id', (req, res) => {
  const id = req.params.id;
  const session = clients[id];

  if (!session) return res.status(404).json({ error: 'Client introuvable' });

  if (session.authenticated) {
    res.json({ status: 'authenticated' });
  } else if (session.qr) {
    res.json({ status: 'scan me', qr: session.qr });
  } else {
    res.json({ status: 'waiting for qr...' });
  }
});

// ✅ Vérifier l’état de connexion
app.get('/checkAuth/:id', (req, res) => {
  const id = req.params.id;
  const session = clients[id];

  if (!session) return res.status(404).json({ error: 'Client introuvable' });

  res.json({ status: session.authenticated ? 'authenticated' : 'not authenticated' });
});

// ✉️ Envoi de message
app.post('/sendMessage', async (req, res) => {
  const { id, number, message } = req.body;

  const session = clients[id];
  if (!session) return res.status(404).json({ error: 'Client introuvable' });
  if (!session.authenticated) return res.status(401).json({ error: 'Client non authentifié' });

  const formatted = number.replace('+', '') + '@c.us';
  try {
    await session.client.sendMessage(formatted, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🌐 Set Webhook
app.post('/setWebhook', (req, res) => {
  const { id, webhookUrl } = req.body;

  const session = clients[id];
  if (!session) return res.status(404).json({ error: 'Client introuvable' });

  session.webhookUrl = webhookUrl;
  res.json({ success: true, message: 'Webhook défini' });
});

app.listen(port, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${port}`);
});
