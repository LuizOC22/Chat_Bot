const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');

// Números de teste
const NUM_A = '5511983947093';
const NUM_B = '5511951014053';
const wid = (num) => `${num}@c.us`;

// Configuração OpenAI (API Key diretamente para teste)
const openai = new OpenAI({
  apiKey: ''
});

// Função para gerar resposta da IA
async function getIAResponse(prompt) {
    const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150
    });
    return completion.choices[0].message.content;
}

// Delay fixo de 1 minuto para teste
const randomDelay = () => 1 * 60 * 1000; // 1 minuto


// Função para enviar mensagem com atraso
async function sendWithDelay(client, to, text) {
    const delay = randomDelay();
    console.log(`⏱️ Próxima mensagem de ${client.options.authStrategy.clientId} em ${Math.floor(delay/60000)} minutos`);
    setTimeout(async () => {
        const response = await getIAResponse(text);
        client.sendMessage(to, response);
        console.log(`Mensagem enviada: "${response}"`);
    }, delay);
}

// Cria clientes
function makeClient(id) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
        puppeteer: { headless: true }
    });

    client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
    client.on('ready', () => console.log(`🤖 Cliente ${id} pronto!`));

    return client;
}

const clientA = makeClient('A');
const clientB = makeClient('B');

// Recebendo mensagens e respondendo com IA
clientA.on('message', async (msg) => {
    if (!msg.fromMe && msg.from === wid(NUM_B)) {
        sendWithDelay(clientA, wid(NUM_B), msg.body);
    }
});

clientB.on('message', async (msg) => {
    if (!msg.fromMe && msg.from === wid(NUM_A)) {
        sendWithDelay(clientB, wid(NUM_A), msg.body);
    }
});

// Inicializa clientes e inicia conversa
clientA.initialize();
clientB.initialize();
clientA.on('ready', () => sendWithDelay(clientA, wid(NUM_B), "Oi B! Vamos conversar 🤖"));
