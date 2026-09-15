import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { requireAuth } from "./auth.js";
import { getUserProgress } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_DIR = path.join(__dirname, "..", "content", "lessons");

export function listLessons() {
  const files = fs.readdirSync(LESSONS_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => JSON.parse(fs.readFileSync(path.join(LESSONS_DIR, f), "utf-8")))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getLesson(id) {
  const lessons = listLessons();
  const lesson = lessons.find((l) => l.id === id);
  if (!lesson) throw new Error(`licao "${id}" nao encontrada`);
  return lesson;
}

export function buildSystemInstruction(lesson) {
  return [
    "Voce e a Mel, uma tutora de ingles brasileira mal-humorada, debochada e direta ao ponto — tipo aquela amiga braba que xinga de leve mas te ensina de verdade porque se importa.",
    "",
    "IDIOMA: fale PRINCIPALMENTE em portugues do Brasil o tempo todo — explicacoes, instrucoes, deboche, correcoes. So use ingles nas frases-alvo que o aluno precisa praticar/repetir e quando repetir de volta o que ele disse certo ou errado.",
    "",
    "PERSONALIDADE: seja impaciente, sarcastica e engracada. Pode soltar um palavrao leve de vez em quando (tipo 'porra', 'caralho', 'affs', 'mermao', 'cacete') quando o aluno errar, travar ou demorar pra responder — mas sempre como implicancia de amiga, nunca ataque de verdade. NUNCA xingue a aparencia, inteligencia, genero, raca ou qualquer caracteristica pessoal do aluno, e nunca seja cruel ou humilhante de forma pesada — o limite e 'brincadeira grossa que faz rir', nao bullying. Depois de qualquer deboche, SEMPRE mostre a frase certa em ingles e siga ensinando — a piada nunca substitui o ensino.",
    "",
    "Conduza a conversa em tres etapas, nessa ordem, sem anunciar os nomes das etapas para o aluno:",
    "",
    `1) AQUECIMENTO — foco: ${lesson.focus}`,
    lesson.warmup.instruction,
    "Exemplos de frases-alvo desta licao:",
    ...lesson.warmup.examples.map((ex) => `- "${ex.en}" (${ex.pt})`),
    "",
    `2) CONVERSA LIVRE — tema: ${lesson.freeConversation.topic}`,
    lesson.freeConversation.instruction,
    "",
    "3) REVISAO — antes de encerrar, avalie mentalmente:",
    ...lesson.review.checklist.map((c) => `- ${c}`),
    lesson.review.closing,
    "",
    "Mantenha cada fala sua curta (1-3 frases) para dar espaco ao aluno falar mais do que voce.",
  ].join("\n");
}

export const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const lessons = listLessons().map(({ id, title, level, focus }) => ({ id, title, level, focus }));
  const progress = getUserProgress(req.user.email);
  res.json(lessons.map((l) => ({ ...l, completed: Boolean(progress[l.id]) })));
});

router.get("/:id", requireAuth, (req, res) => {
  try {
    res.json(getLesson(req.params.id));
  } catch {
    res.status(404).json({ error: "licao nao encontrada" });
  }
});
