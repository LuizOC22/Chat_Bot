require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// === CONFIGURAÇÕES ===
const CLIENT_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']; // IDs dos bots (clientId)
const readyClients = new Set();
const clients = {};
const respondedMessages = new Set(); // Evita loop infinito
const pendingMessages = new Set();   // Marca mensagens aguardando resposta

// === IA: Gemini ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getIAResponse(userMessage) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
        Você deve conversar de forma natural, como uma pessoa real, falando sobre cotidiano e estilo de vida.

Objetivo:
- Responda com mensagens curtas, descontraídas e variadas.
- Traga leveza, naturalidade e evite repetir frases ou estruturas.
- Comente de forma espontânea sobre a rotina, descanso, cansaço, distrações, comida, tempo, transporte, humor, etc.
- Use gírias ou abreviações leves se quiser (tipo “kkk”, “to de boa”, “vdd”, “hj tá puxado”).
- Não seja formal nem técnico. Fale como se estivesse no WhatsApp.
- Nunca repita exatamente a mesma ideia ou expressão.
- Varie o tom: pode ser animado, irônico, cansado, distraído, animado, relaxado… como alguém real.

Exemplos de estilo:
- “hj só queria um café e silêncio kkk”
- “tô aqui enrolando pra sair da cama 😴”
- “dia corrido, mas tamo indo…”
- “nem vi a hora passar, o dia voou”
- “finalmente sexta!!”

Usuário: ${userMessage}


    `;

    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text();
}

// === Funções auxiliares ===
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

// === Reiniciar cliente após desconexão ===
function restartClient(clientId) {
    console.log(`♻️ Reiniciando cliente ${clientId}...`);

    const sessionPath = path.join(__dirname, 'puppeteer_data', clientId);

    async function doRestart() {
        // Limpa o client da memória
        if (clients[clientId]) {
            try {
                await clients[clientId].destroy(); // Aguarda destruir o cliente
                console.log(`🛑 Cliente ${clientId} destruído.`);
            } catch (e) {
                console.warn(`Erro ao destruir cliente ${clientId}:`, e.message);
            }

            delete clients[clientId];
            readyClients.delete(clientId);
        }

        // Aguarda um tempo antes de apagar
        setTimeout(() => {
            try {
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(`🧹 Sessão limpa para cliente ${clientId}`);
                }
            } catch (err) {
                console.error(`❌ Erro ao apagar a pasta da sessão:`, err);
            }

            // Reinicializa o cliente
            createClient(clientId);
        }, 2000); // espera 2s para garantir que o Chrome fechou
    }

    doRestart();
}


// === Criar cliente WhatsApp ===
function createClient(id) {
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

    client.on('qr', qr => {
        console.log(`📲 QR Code para cliente ${id}:`);
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        const wid = client.info.wid._serialized;
    console.log(`🤖 Cliente ${id} conectado com número: ${wid}`);

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

                        const mensagensIniciais = [
                        "E aí, tudo certo por aí? 😄",
                        "Fala aí! Bora trocar uma ideia?",
                        "Tá on? Tava pensando em uns códigos aqui kkk",
                        "Mano, me diz se já usou algum framework novo ultimamente?",
                        "A IA tá doida ultimamente né? 😂"
];

                const msgAleatoria = mensagensIniciais[Math.floor(Math.random() * mensagensIniciais.length)];

                sendWithDelay(sender, receiverWid, msgAleatoria);

                    }
                });
            });
        }
    });

    client.on('message', async msg => {
        const myId = client.options.authStrategy.clientId;

        if (respondedMessages.has(msg.id._serialized)) return;

        for (const [otherId, otherClient] of Object.entries(clients)) {
            const senderWid = otherClient?.info?.wid?._serialized;

            if (otherId !== myId && senderWid === msg.from) {
                const key = `${otherId}_${myId}`;
                pendingMessages.delete(key);
                console.log(`💬 [${myId}] recebeu mensagem de [${otherId}]`);
                respondedMessages.add(msg.id._serialized);
                sendWithDelay(client, msg.from, msg.body);
                break;
            }
        }
    });

    client.on('disconnected', (reason) => {
        console.log(`❌ Cliente ${id} foi desconectado. Motivo: ${reason}`);
        restartClient(id); // Recria automaticamente
    });

    client.initialize();
}

// === Inicializa todos os bots ===
CLIENT_IDS.forEach(id => createClient(id));
