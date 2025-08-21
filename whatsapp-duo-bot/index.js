require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// IDs dos clientes
const CLIENT_IDS = ['A', 'B', 'C', 'D'];

// Defina os pares de conversa (quem responde quem)
const PAIRS = {
  A: 'B',
  B: 'A',
  C: 'D',
  D: 'C'
};

// Instancia a IA Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getIAResponse(userMessage) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
        Responda de forma breve, clara e natural.
        Use no máximo um parágrafo. Evite explicações longas.
        Usuário: ${userMessage}
    `;

    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text();
}

// Delay aleatório entre 1 e 10 minutos
const randomDelay = () => {
    const min = 1 * 60 * 1000;
    const max = 10 * 60 * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Função para enviar mensagem com atraso
async function sendWithDelay(client, to, text) {
    const delay = randomDelay();
    console.log(`⏱️ Próxima mensagem de ${client.options.authStrategy.clientId} em ${Math.floor(delay / 60000)} minutos`);
    setTimeout(async () => {
        const response = await getIAResponse(text);
        client.sendMessage(to, response);
        console.log(`📤 [${client.options.authStrategy.clientId}] enviou: "${response}"`);
    }, delay);
}

// Armazena os clientes
const clients = {};

// Cria os clientes dinamicamente
CLIENT_IDS.forEach(id => {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
        puppeteer: { headless: true }
    });

    client.on('qr', qr => qrcode.generate(qr, { small: true }));
    client.on('ready', () => {
        console.log(`🤖 Cliente ${id} pronto!`);

        // Enviar primeira mensagem automaticamente
        const pairId = PAIRS[id];
        if (pairId && clients[pairId]) {
            const to = `${clients[pairId].info.wid._serialized}`;
            sendWithDelay(client, to, "Oi! Vamos conversar 🤖");
        }
    });

    client.on('message', async msg => {
        const myId = client.options.authStrategy.clientId;
        const expectedSenderId = PAIRS[myId];
        const expectedSender = clients[expectedSenderId]?.info?.wid?._serialized;

        // Só responde se veio do par correspondente
        if (!msg.fromMe && msg.from === expectedSender) {
            sendWithDelay(client, msg.from, msg.body);
        }
    });

    client.initialize();
    clients[id] = client;
});
