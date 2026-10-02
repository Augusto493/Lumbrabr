import { GoogleGenAI, Type } from "@google/genai";
import { listLessons } from "./lessons.js";
import { lang, languageOf } from "./languages.js";
import * as settings from "./settings.js";

export const LEVEL_GUIDE = {
  en: {
    A0: "quem nunca falou ingles: frases de 3-5 palavras, tudo traduzido, roteiro guiado onde a Mel dita cada fala",
    A1: "iniciante: presente simples, verbo to be, vocabulario do dia a dia, frases curtas",
    A2: "basico: passado simples, perguntas com do/does, preposicoes, descrever lugares e rotina",
    B1: "intermediario: present perfect, opiniao, conectores simples, falsos amigos, conversas de 5-6 trocas",
    B2: "intermediario-avancado: condicionais, entrevista, argumentar, phrasal verbs comuns, conversa fluida",
    C1: "avancado: narrativa com past perfect, negociacao, nuance e registro formal/informal, quase tudo em ingles",
  },
  es: {
    A0: "quem nunca falou espanhol: frases de 3-5 palavras, tudo traduzido, roteiro guiado onde a Mel dita cada fala, e ja desmontando o portunhol",
    A1: "iniciante: ser/estar, tener, presente regular, artigos e genero (la leche, el viaje), cumprimentos",
    A2: "basico: gustar e parecidos, preterito indefinido (fui, comi, hablé), muy x mucho, rotina e compras",
    B1: "intermediario: falsos cognatos, preterito perfecto x indefinido, opiniao (creo que, me parece), conversas de 5-6 trocas",
    B2: "intermediario-avancado: subjuntivo presente (ojalá, cuando llegues), condicional, argumentar, conversa fluida",
    C1: "avancado: subjuntivo imperfeito (si tuviera), registro formal (usted) e informal, expressoes idiomaticas, quase tudo em espanhol",
  },
};

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    level: { type: Type.STRING },
    focus: { type: Type.STRING },
    warmup: {
      type: Type.OBJECT,
      properties: {
        instruction: { type: Type.STRING },
        examples: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { target: { type: Type.STRING }, pt: { type: Type.STRING } }, required: ["target", "pt"] } },
      },
      required: ["instruction", "examples"],
    },
    freeConversation: { type: Type.OBJECT, properties: { topic: { type: Type.STRING }, instruction: { type: Type.STRING } }, required: ["topic", "instruction"] },
    review: { type: Type.OBJECT, properties: { checklist: { type: Type.ARRAY, items: { type: Type.STRING } }, closing: { type: Type.STRING } }, required: ["checklist", "closing"] },
  },
  required: ["title", "level", "focus", "warmup", "freeConversation", "review"],
};

// o modelo principal as vezes responde 503 (pico de demanda): tenta de novo e,
// se insistir, cai pros modelos reserva
// models: lista propria (ex.: TTS); sem ela usa o modelo de texto + reservas
export async function withRetry(run, models) {
  const textModel = settings.get("GEMINI_TEXT_MODEL");
  const fallbacks = (settings.get("GEMINI_TEXT_FALLBACKS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const attempts = models?.length ? [models[0], ...models] : [textModel, textModel, ...fallbacks];
  let lastError;
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await run(attempts[i]);
    } catch (err) {
      lastError = err;
      const msg = String(err.message ?? err);
      const transient = /503|UNAVAILABLE|high demand|429|RESOURCE_EXHAUSTED|overloaded/i.test(msg);
      const missing = /404|NOT_FOUND|not found|no longer available/i.test(msg);
      if (!transient && !missing) throw err;
      if (i < attempts.length - 1) await new Promise((r) => setTimeout(r, transient ? 2500 : 0));
    }
  }
  throw new Error(`o Gemini nao respondeu (${String(lastError?.message ?? lastError).slice(0, 160)})`);
}

export async function generateLesson({ level = "A2", theme = "", language = "en" } = {}) {
  language = languageOf(language);
  const L = lang(language);
  const guide = LEVEL_GUIDE[language][level];
  if (!guide) throw new Error("nivel invalido (A0, A1, A2, B1, B2, C1)");
  const existing = listLessons(true, language);
  // exemplos de formato: duas licoes do mesmo idioma (ou as de ingles, se ainda nao houver)
  const pool = existing.length >= 2 ? existing : listLessons(true, "en");
  const samples = pool.slice(1, 3).map(({ id, active, ...rest }) => rest);

  const prompt = [
    `Voce escreve licoes para a Mel, uma tutora de ${L.name} por voz, brasileira, mal-humorada e debochada, que ensina em portugues e usa ${L.name} so nas frases-alvo.`,
    "Cada licao e um JSON com: title, level, focus, warmup{instruction, examples[{target,pt}]}, freeConversation{topic, instruction}, review{checklist[], closing}. 'target' e a frase no idioma da licao.",
    `As instrucoes sao roteiros PARA A MEL (segunda pessoa, imperativo, em portugues do Brasil com acentos), nao texto para o aluno. Cada licao caça UM erro tipico de brasileiro falando ${L.name} e o nomeia explicitamente.`,
    L.traps,
    "Exemplos de licoes ja existentes (o formato importa, o idioma das frases pode ser outro):",
    JSON.stringify(samples, null, 1),
    "",
    `Crie UMA licao NOVA de ${L.name}, nivel ${level} (${guide}).`,
    theme ? `Tema pedido: ${theme}.` : "Escolha um tema util do dia a dia ou do trabalho que ainda nao exista.",
    `Titulos que ja existem (nao repita nem parafraseie): ${existing.map((l) => l.title).join(" | ") || "nenhum"}.`,
    `Regras: 3 examples com target (em ${L.name}) e pt; checklist com 2 ou 3 itens; warmup.instruction e freeConversation.instruction com 2-4 frases cada; title curto e com gancho; level exatamente igual ao pedido.`,
    "Responda somente com o JSON.",
  ].join("\n");

  const ai = new GoogleGenAI({ apiKey: settings.get("GEMINI_API_KEY") });
  const res = await withRetry((model) => ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.9 },
  }));
  let lesson;
  try { lesson = JSON.parse(res.text); } catch { throw new Error("o modelo nao devolveu JSON valido"); }
  lesson.level = level;
  lesson.language = language;
  // grava a frase-alvo com a chave do idioma ({en} ou {es}), como nas licoes escritas a mao
  if (Array.isArray(lesson.warmup?.examples)) {
    lesson.warmup.examples = lesson.warmup.examples.map((ex) => ({ [language]: ex.target ?? ex[language] ?? "", pt: ex.pt }));
  }
  if (!lesson.title || !lesson.warmup?.examples?.length || !lesson.review?.checklist?.length) throw new Error("licao gerada veio incompleta");
  return lesson;
}
