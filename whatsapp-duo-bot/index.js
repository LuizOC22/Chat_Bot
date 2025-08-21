require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const CLIENT_IDS = ['A', 'B', 'C',];
const readyClients = new Set();
const clients = {};
const respondedMessages = new Set(); // Evita loop infinito


// true se está aguardando resposta
const pendingMessages = new Set();


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

const randomDelay = () => {
    const min = 1 * 60 * 1000;
    const max = 10 * 60 * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

async function sendWithDelay(client, to, text) {
    const fromId = client.options.authStrategy.clientId;
    const toId = Object.entries(clients).find(([_, c]) => c.info.wid._serialized === to)?.[0];

    if (!toId) return;

    const key = `${fromId}_${toId}`;

    // Se já existe uma pendência, não envia
    if (pendingMessages.has(key)) {
        console.log(`⏳ [${fromId}] já tem mensagem pendente para [${toId}]. Aguardando resposta...`);
        return;
    }

    const delay = randomDelay();
    console.log(`⏱️ Próxima mensagem de ${fromId} para ${toId} em ${Math.floor(delay / 60000)} minutos`);

    pendingMessages.add(key);

    setTimeout(async () => {
        const response = await getIAResponse(text);
        client.sendMessage(to, response);
        console.log(`📤 [${fromId}] enviou para [${toId}]: "${response}"`);
    }, delay);
}


// Cria os clientes dinamicamente
CLIENT_IDS.forEach(id => {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
        puppeteer: {
            headless: true,
            args: [
                `--user-data-dir=./puppeteer_data/${id}`,
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        }
    });

    client.on('qr', qr => qrcode.generate(qr, { small: true }));

    client.on('ready', () => {
        console.log(`🤖 Cliente ${id} pronto!`);
        clients[id] = client;
        readyClients.add(id);

        if (readyClients.size === CLIENT_IDS.length) {
            console.log("🚀 Todos os bots estão prontos. Iniciando conversas...");

            CLIENT_IDS.forEach(senderId => {
                const sender = clients[senderId];
                const senderWid = sender.info.wid._serialized;

                CLIENT_IDS.forEach(receiverId => {
                    if (senderId !== receiverId) {
                        const receiver = clients[receiverId];
                        const receiverWid = receiver.info.wid._serialized;

                        sendWithDelay(sender, receiverWid, "Oi! Vamos conversar 🤖");
                    }
                });
            });
        }
    });


    client.on('message', async msg => {
    const myId = client.options.authStrategy.clientId;

    // Ignora se já respondeu a esta mensagem
    if (respondedMessages.has(msg.id._serialized)) return;

    for (const [otherId, otherClient] of Object.entries(clients)) {
        const senderWid = otherClient?.info?.wid?._serialized;

        if (
            otherId !== myId &&
            senderWid === msg.from
        ) {
            const key = `${otherId}_${myId}`; // Remover pendência
            pendingMessages.delete(key);

            console.log(`💬 [${myId}] recebeu mensagem de [${otherId}]`);
            respondedMessages.add(msg.id._serialized);

            // Agora posso responder de volta
            sendWithDelay(client, msg.from, msg.body);
            break;
        }
    }
});


      client.on('disconnected', (reason) => {
            console.log(`❌ Cliente ${id} foi desconectado. Motivo: ${reason}`);
        });


    client.initialize();
});
