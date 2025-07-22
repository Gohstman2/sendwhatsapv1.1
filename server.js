const express = require("express");
const fs = require("fs");
const cors = require("cors");
const P = require("pino");
const {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json());
app.use(cors());

const clients = {}; // stockage des clients par numéro

// 📌 Créer une nouvelle session ou récupérer une existante
async function getClient(numero) {
    if (clients[numero]) return clients[numero];

    const authDir = `./sessions/${numero}`;
    fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        version: await fetchLatestBaileysVersion(),
        logger: P({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P().info),
        },
        browser: ["BKM BOT", "Chrome", "1.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                getClient(numero);
            } else {
                delete clients[numero];
            }
        }
    });

    clients[numero] = sock;
    return sock;
}

// 📱 Route 1 : Authentification => Renvoie un pairing code
app.post("/auth", async (req, res) => {
    const { numero } = req.body;
    if (!numero) return res.status(400).json({ error: "Numéro requis" });

    try {
        const sock = await getClient(numero);
        const code = await sock.requestPairingCode(numero);
        res.json({ code });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Échec d'authentification" });
    }
});

// ✅ Route 2 : Vérifie si le client est connecté
app.post("/checkAuth", async (req, res) => {
    const { numero } = req.body;
    if (!numero) return res.status(400).json({ error: "Numéro requis" });

    try {
        const sock = clients[numero];
        if (sock && sock.user) {
            res.json({ connected: true, user: sock.user });
        } else {
            res.json({ connected: false });
        }
    } catch (err) {
        res.status(500).json({ error: "Erreur de vérification" });
    }
});

// ✉️ Route 3 : Envoi de message
app.post("/sendMessage", async (req, res) => {
    const { from, to, message } = req.body;
    if (!from || !to || !message) {
        return res.status(400).json({ error: "Champs requis : from, to, message" });
    }

    try {
        const sock = await getClient(from);
        await sock.sendMessage(to + "@s.whatsapp.net", { text: message });
        res.json({ status: "message envoyé" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur lors de l'envoi du message" });
    }
});

app.listen(3000, () => {
    console.log("✅ Serveur WhatsApp Baileys actif sur http://localhost:3000");
});
