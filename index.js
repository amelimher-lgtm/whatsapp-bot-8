const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3008;
const DATA_DIR = process.env.DATA_DIR || '/mnt/data';
const DATA_FILE = path.join(DATA_DIR, 'repliedNumbers_bot8.json');
const AUTH_DIR = path.join(DATA_DIR, '.wwebjs_auth/bot8');

// ------------------
// Ensure directories exist
// ------------------
function ensureDirectories() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }
        console.log('✅ Directories verified');
    } catch (err) {
        console.error('❌ Failed to create directories:', err);
    }
}

ensureDirectories();

// ------------------
// Track bot status
// ------------------
let latestQRCode = null;
let isReady = false;
let isInitializing = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 10000; // 10 seconds

// ------------------
// Load existing replied numbers
// ------------------
let repliedNumbers = [];
function loadRepliedNumbers() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            repliedNumbers = JSON.parse(data);
            console.log(`✅ Loaded ${repliedNumbers.length} replied numbers`);
        } catch (err) {
            console.error('❌ Failed to load replied numbers:', err);
            repliedNumbers = [];
        }
    }
}

function saveRepliedNumbers() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(repliedNumbers, null, 2));
    } catch (err) {
        console.error('❌ Failed to save replied numbers:', err);
    }
}

loadRepliedNumbers();

// ------------------
// WhatsApp client with persistent session
// ------------------
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'bot8',
        dataPath: AUTH_DIR
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// ------------------
// QR code event
// ------------------
client.on('qr', async qr => {
    try {
        latestQRCode = await qrcode.toDataURL(qr);
        isReady = false;
        reconnectAttempts = 0; // Reset on new QR
        console.log('✅ QR Code generated – scan it in the browser to log in.');
    } catch (err) {
        console.error('❌ Failed to generate QR code:', err);
    }
});

// ------------------
// Ready event
// ------------------
client.on('ready', () => {
    console.log('🤖 WhatsApp API is ready and connected!');
    isReady = true;
    isInitializing = false;
    reconnectAttempts = 0;
    latestQRCode = null; // Clear QR once connected
});

// ------------------
// Authenticated event
// ------------------
client.on('authenticated', () => {
    console.log('✅ Client authenticated successfully');
});

// ------------------
// Authentication failure event
// ------------------
client.on('auth_failure', msg => {
    console.error('❌ Authentication failure:', msg);
    isReady = false;
    isInitializing = false;
});

// ------------------
// Handle disconnection & auto-reconnect with exponential backoff
// ------------------
client.on('disconnected', reason => {
    console.log(`⚠️ Disconnected due to: ${reason}`);
    isReady = false;
    latestQRCode = null;

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !isInitializing) {
        reconnectAttempts++;
        const delay = RECONNECT_DELAY * reconnectAttempts;
        console.log(`♻️ Reconnecting in ${delay / 1000} seconds (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        
        setTimeout(() => {
            if (!isInitializing && !isReady) {
                console.log('♻️ Attempting to reinitialize client...');
                isInitializing = true;
                client.initialize().catch(err => {
                    console.error('❌ Failed to reinitialize:', err);
                    isInitializing = false;
                });
            }
        }, delay);
    } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('❌ Max reconnection attempts reached. Manual intervention required.');
    }
});

// ------------------
// Handle loading screen
// ------------------
client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Loading: ${percent}% - ${message}`);
});

// ------------------
// Message handler: auto-reply only to new private numbers
// ------------------
client.on('message', async msg => {
    try {
        const sender = msg.from;

        // Ignore messages from groups
        if (sender.endsWith('@g.us')) {
            console.log(`ℹ️ Message from a group ${sender}, ignoring.`);
            return;
        }

        // Ignore status broadcasts
        if (sender === 'status@broadcast') {
            console.log('ℹ️ Status broadcast, ignoring.');
            return;
        }

        // Check if sender is already replied
        if (!repliedNumbers.includes(sender)) {
            const replyMessage = 'Hello! 👋 Thanks for messaging IBETIN. We will get back to you shortly.';
            
            await msg.reply(replyMessage);
            console.log(`✅ Auto-reply sent to new private number: ${sender}`);

            // Save this number to memory & file
            repliedNumbers.push(sender);
            saveRepliedNumbers();
        } else {
            console.log(`ℹ️ Message from existing number: ${sender}, no auto-reply sent.`);
        }
    } catch (err) {
        console.error(`❌ Failed to process message:`, err);
    }
});

// ------------------
// Handle errors
// ------------------
client.on('error', error => {
    console.error('❌ Client error:', error);
});

// ------------------
// Initialize client
// ------------------
console.log('🚀 Initializing WhatsApp client...');
isInitializing = true;
client.initialize().catch(err => {
    console.error('❌ Failed to initialize client:', err);
    isInitializing = false;
});

// ------------------
// Express middleware
// ------------------
app.use(express.json());

// ------------------
// Health check endpoint
// ------------------
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        whatsappReady: isReady,
        timestamp: new Date().toISOString()
    });
});

// ------------------
// Express route for QR/status
// ------------------
app.get('/', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="refresh" content="5">
            <title>WhatsApp Bot Status</title>
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                    text-align: center; 
                    padding: 50px 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    min-height: 100vh;
                    margin: 0;
                }
                .container {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 500px;
                    margin: 0 auto;
                    backdrop-filter: blur(10px);
                }
                h1 {
                    margin-bottom: 30px;
                    font-size: 2rem;
                }
                img { 
                    width: 250px; 
                    margin: 20px 0;
                    border-radius: 10px;
                    background: white;
                    padding: 20px;
                }
                .status { 
                    font-size: 1.2rem; 
                    margin: 20px 0;
                    padding: 15px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 10px;
                }
                .info {
                    font-size: 0.9rem;
                    margin-top: 20px;
                    opacity: 0.8;
                }
                .button {
                    display: inline-block;
                    padding: 15px 30px;
                    margin: 20px 10px;
                    background: rgba(255, 255, 255, 0.9);
                    color: #667eea;
                    text-decoration: none;
                    border-radius: 10px;
                    font-weight: bold;
                    transition: all 0.3s ease;
                    font-size: 1rem;
                }
                .button:hover {
                    background: white;
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
                }
                .button.primary {
                    background: #25D366;
                    color: white;
                }
                .button.primary:hover {
                    background: #20BA5A;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 WhatsApp API Status</h1>
                ${
                    !isReady && latestQRCode
                        ? `<div class="status">📱 Waiting for WhatsApp login...</div>
                           <img src="${latestQRCode}" alt="QR Code" />
                           <div class="info">Scan this QR code with WhatsApp to connect</div>`
                        : isReady
                        ? `<div class="status">✅ Connected to WhatsApp successfully!</div>
                           <div class="info">Replied to ${repliedNumbers.length} unique numbers</div>
                           <div style="margin-top: 30px;">
                               <a href="https://web.whatsapp.com" target="_blank" class="button primary">
                                   💬 Open WhatsApp Web
                               </a>
                           </div>`
                        : `<div class="status">⏳ Initializing, please wait...</div>
                           <div class="info">This may take a few moments</div>`
                }
                <div class="info" style="margin-top: 30px;">
                    Page auto-refreshes every 5 seconds
                </div>
            </div>
        </body>
        </html>
    `;
    res.send(html);
});

// ------------------
// API endpoint to get status
// ------------------
app.get('/api/status', (req, res) => {
    res.json({
        isReady,
        hasQR: !!latestQRCode,
        repliedCount: repliedNumbers.length,
        reconnectAttempts
    });
});

// ------------------
// Graceful shutdown
// ------------------
process.on('SIGTERM', async () => {
    console.log('⚠️ SIGTERM received, shutting down gracefully...');
    try {
        saveRepliedNumbers();
        await client.destroy();
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during shutdown:', err);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log('⚠️ SIGINT received, shutting down gracefully...');
    try {
        saveRepliedNumbers();
        await client.destroy();
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during shutdown:', err);
        process.exit(1);
    }
});

// ------------------
// Handle uncaught exceptions
// ------------------
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    saveRepliedNumbers();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ------------------
// Start Express server
// ------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📊 Visit http://localhost:${PORT} to see bot status`);
});
