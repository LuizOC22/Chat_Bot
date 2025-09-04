require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { group } = require('console');

// === CONFIGURAÇÕES ===

const CLIENT_IDS = ['A', 'D']; // IDs dos bots (clientId)

const GROUPS = gerarGrupos(CLIENT_IDS, 2);

const readyClients = new Set();
const clients = {};
const respondedMessages = new Set(); // Evita loop infinito
const pendingMessages = new Set();   // Marca mensagens aguardando resposta

// === IA: Gemini ===
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
async function getIAResponse(formattedHistory, text) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
Você está conversando com um amigo no WhatsApp.

Objetivo:
- Responda com mensagens curtas, descontraídas e variadas.
- Traga leveza, naturalidade e evite repetir frases ou estruturas.
- Comente de forma espontânea sobre a rotina, descanso, cansaço, distrações, comida, tempo, transporte, humor, etc.
- Use gírias ou abreviações leves se quiser (tipo “kkk”, “to de boa”, “vdd”, “hj tá puxado”).
- Não seja formal nem técnico. Fale como se estivesse no WhatsApp.
- Nunca repita exatamente a mesma ideia ou expressão.
- Varie o tom: pode ser animado, irônico, cansado, distraído, relaxado… como alguém real.
- Evite parecer uma IA. Responda como se fosse sempre a mesma pessoa da conversa (com o mesmo estilo e humor).

Estilo de exemplo:
- “hj só queria um café e silêncio kkk”
- “tô aqui enrolando pra sair da cama 😴”
- “dia corrido, mas tamo indo…”
- “nem vi a hora passar, o dia voou”
- “finalmente sexta!!”

Aqui está a conversa até agora (você é "Você" e seu amigo é "Outro"):

${formattedHistory}

Seu amigo acabou de mandar: "${text}"

Responda como se estivesse continuando essa conversa, no mesmo estilo, de forma coerente e natural.
`;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (err) {
        console.error("❌ Erro na chamada ao Gemini:", err.message);
        throw err;
    }
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

    setTimeout(() => {
        processDelayedResponse(client, fromId, toId, to, text, key);
    }, delay);
}
// salva conversa 
async function processDelayedResponse(client, fromId, toId, to, text, key) {
    try {
        // Salva a mensagem recebida no histórico
        const history = addToChatHistory(fromId, toId, text);

        // Formata o histórico como conversa (Você / Outro)
        const formattedHistory = history.map(h => {
            return `${h.from === fromId ? "Você" : "Outro"}: ${h.message}`;
        }).join("\n");

        // Cria o prompt para a IA
        const prompt = `
Você está conversando com um amigo no WhatsApp, de forma bem informal.

Aqui está a conversa recente:
${formattedHistory}

Mensagem recebida agora: "${text}"

Responda essa última mensagem de forma leve, divertida ou natural, como alguém real responderia.
        `;

        // Tenta obter resposta da IA
        let response;
        try {
            response = await getIAResponse(formattedHistory, text);

            console.log("🤖 Resposta da IA:", response);
        } catch (e) {
            console.warn(`⚠️ IA indisponível. Usando mensagem antiga entre ${fromId} e ${toId}`);
            response = getRandomPastMessage(fromId, toId) || getFallbackMessage();
        }

        // Envia a resposta pelo WhatsApp
        try {
            console.log(`🚚 Enviando para ${to}: "${response}"`);
            await client.sendMessage(to, response);
            console.log(`📤 [${fromId}] enviou para [${toId}]: "${response}"`);
        } catch (e) {
            console.error(`❌ Erro ao enviar mensagem de [${fromId}] para [${toId}]:`, e.message);
        }

        // Salva a resposta no histórico
        addToChatHistory(fromId, toId, response);

    } catch (error) {
        console.error(`⚠️ Erro geral ao gerar resposta de ${fromId} para ${toId}:`, error.message);
    } finally {
        pendingMessages.delete(key);
    }
}




const CHAT_HISTORY_FILE = './chat_history.json';

function loadChatHistory() {
    try {
        const data = fs.readFileSync(CHAT_HISTORY_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

function saveChatHistory(history) {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(history, null, 2));
}

function addToChatHistory(from, to, message) {
    const history = loadChatHistory();
    const key = `${from}_${to}`;
    
    if (!history[key]) history[key] = [];

    history[key].push({
        from,
        to,
        message,
        timestamp: Date.now()
    });


    saveChatHistory(history);
    return history[key];
}

function getRandomPastMessage(from, to) {
    const history = loadChatHistory();
    const key = `${from}_${to}`;

    const pairHistory = history[key] || [];

    // Filtra só mensagens enviadas POR 'from'
    const sentMessages = pairHistory.filter(entry => entry.from === from);

    if (sentMessages.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * sentMessages.length);
    return sentMessages[randomIndex].message;
}




// === Reiniciar cliente após desconexão ===
function restartClient(clientId) {
    console.log(`♻️ Reiniciando cliente ${clientId}...`);

    async function doRestart() {
        if (clients[clientId]) {
            try {
                await clients[clientId].destroy();
                console.log(`🛑 Cliente ${clientId} destruído.`);
            } catch (e) {
                console.warn(`⚠️ Erro ao destruir cliente ${clientId}:`, e.message);
            }

            delete clients[clientId];
            readyClients.delete(clientId);
        }

        // espera mais tempo pra liberar o Chromium
        setTimeout(() => createClient(clientId), 8000);
    }

    doRestart();
}


// === Criar cliente WhatsApp ===
 
function createClient(id) {
    console.log(`🔧 Criando cliente ${id}...`);

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: id,
            dataPath: path.join(__dirname, 'sessions') // força salvar em ./sessions
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-accelerated-2d-canvas',
                '--disable-software-rasterizer',
            ],
            timeout: 60000
        }
    });

    const qrShown = new Set();

    client.on('qr', qr => {
        if (!qrShown.has(id)) {
            console.log(`📲 QR Code para cliente ${id}:`);
            qrcode.generate(qr, { small: true });
            qrShown.add(id);
        } else {
            console.log(`🔄 Novo QR code gerado para cliente ${id}, aguardando escaneamento...`);
        }
    });

    client.on('authenticated', () => {
        console.log(`🔐 Cliente ${id} autenticado com sucesso.`);
    });

    client.on('auth_failure', () => {
        console.error(`❌ Falha de autenticação no cliente ${id}.`);
    });

    client.on('ready', async () => {
        console.log(`✅ Evento 'ready' disparado para ${id}`);

        try {
            // Aguarda até o info estar disponível
            let wid;
            let attempts = 0;
            while ((!client.info || !client.info.wid) && attempts < 10) {
                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!client.info || !client.info.wid) {
                throw new Error("client.info.wid não disponível após tentativas.");
            }

            wid = client.info.wid._serialized;
            console.log(`🤖 Cliente ${id} conectado com número: ${wid}`);

            clients[id] = client;
            readyClients.add(id);

            // dispara conversas iniciais quando todos prontos
            if (readyClients.size === CLIENT_IDS.length) {
                console.log("🚀 Todos os bots estão prontos. Iniciando conversas...");
                iniciarConversas();
            }
        } catch (err) {
            console.error(`❌ Erro no evento 'ready' do cliente ${id}:`, err);
        }
    });

    client.on('message', async msg => {
        const myId = id;

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
        restartClient(id);
    });

    try {
        client.initialize();
    } catch (err) {
        console.error(`⚠️ Erro ao inicializar cliente ${id}:`, err.message);
        restartClient(id);
    }
}

// cria grupos de bots automaticamente 
function gerarGrupos(bots, tamanhoGrupo = 2) {
    const grupos = [];
    const botsDisponiveis = [...bots]; 

    while (botsDisponiveis.length >= tamanhoGrupo) {
        const grupo = botsDisponiveis.splice(0, tamanhoGrupo);
        grupos.push(grupo);
    }

    // Se sobrar algum bot sem par
    if (botsDisponiveis.length > 0) {
        console.warn("⚠️ Sobrou bot sem grupo:", botsDisponiveis);
    }

    return grupos;
}

// === Função para iniciar conversas quando todos os bots estiverem prontos
function iniciarConversas() {
    GROUPS.forEach(group => {
        group.forEach(senderId => {
            const sender = clients[senderId];
            const senderWid = sender.info.wid._serialized;

            group.forEach(receiverId => {
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
    });
}

// === Inicializa todos os bots ===
CLIENT_IDS.forEach(id => createClient(id));
