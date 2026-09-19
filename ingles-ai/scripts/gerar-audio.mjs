// Gera os audios da Mel usados nas telas de entrada (intro, perguntas, login).
// Uso: node scripts/gerar-audio.mjs [nome-do-clipe ...]   (sem argumentos = todos)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Modality } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "audio");
const SAMPLE_RATE = 24000;

export const LINES = {
  intro1: "Oi. Eu sou a Mel. A professora de inglês que não tem paciência nenhuma. Mas relaxa: eu faço você falar.",
  intro2: "Três minutos por dia de conversa comigo. Sem enrolação, sem lista de verbo, sem desculpa.",
  intro3: "Sua professora de I.A. particular. Disponível a qualquer hora, em qualquer lugar. Mal-humorada em todos eles.",
  proof: "Essa gente aí não me aguenta mais. Mas parou de travar em inglês. Coincidência? Não.",
  q_voice: "Antes de começar: como você prefere me ouvir? Escolhe aí.",
  q_level: "Quanto você entende de inglês? Responde com sinceridade. Eu vou descobrir de qualquer jeito.",
  q_blocker: "E o que mais te trava na hora de falar? Sem julgamento. Tá, um pouco.",
  q_tone: "Última: como você quer que eu fale com você? Pensa bem.",
  plan: "Sua rotina comigo: aquecimento, conversa livre, revisão. Todo dia. Curto. Sem desculpa.",
  projection: "Se você mantiver cinco minutos por dia, chega lá. Se não mantiver, a culpa não é minha.",
  commit: "Topa falar comigo cinco minutos por dia, cinco dias por semana? Toca em mim pra se comprometer. Sem meta, sem nota.",
  login: "Ah, voltou. Entra aí que eu não tenho o dia todo.",
  register: "Cria sua conta. Prometo que só vou te cobrar em inglês.",
};

const SYSTEM = [
  "Voce e a Mel, tutora de ingles brasileira, mal-humorada e debochada, com voz de quem ja esta cansada mas gosta de voce.",
  "O usuario vai mandar um texto. LEIA EM VOZ ALTA EXATAMENTE esse texto, palavra por palavra, com a atitude da Mel.",
  "Nao acrescente nada antes nem depois. Nao comente. Nao cumprimente. So leia o texto.",
].join("\n");

function wav(pcm16) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

async function gerar(ai, name, text) {
  const chunks = [];
  let transcript = "";
  await new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), 40000);
    let session;
    try {
      session = await ai.live.connect({
        model: process.env.GEMINI_LIVE_MODEL,
        config: { responseModalities: [Modality.AUDIO], systemInstruction: SYSTEM, outputAudioTranscription: {} },
        callbacks: {
          onmessage: (m) => {
            for (const p of m?.serverContent?.modelTurn?.parts ?? []) if (p.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, "base64"));
            const t = m?.serverContent?.outputTranscription?.text;
            if (t) transcript += t;
            if (m?.serverContent?.turnComplete) { clearTimeout(timeout); session.close(); resolve(); }
          },
          onerror: (e) => { clearTimeout(timeout); reject(e); },
        },
      });
      session.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
    } catch (e) { clearTimeout(timeout); reject(e); }
  });
  const pcm = Buffer.concat(chunks);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.wav`), wav(pcm));
  return { seconds: (pcm.length / 2 / SAMPLE_RATE).toFixed(1), transcript: transcript.trim() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(LINES);
  for (const name of names) {
    if (!LINES[name]) { console.log(`clipe desconhecido: ${name}`); continue; }
    try {
      const r = await gerar(ai, name, LINES[name]);
      console.log(`${name}.wav  ${r.seconds}s  "${r.transcript}"`);
    } catch (e) {
      console.log(`${name}: FALHOU — ${e.message}`);
    }
    // espaco entre chamadas por causa do limite por minuto do plano gratis
    await new Promise((r) => setTimeout(r, 7000));
  }
}
