import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { verifyToken } from "./auth.js";
import { withRetry } from "./generate.js";
import { lang, languageOf } from "./languages.js";
import { contentStore } from "./content.js";
import { slugify } from "./lessons.js";
import { findUserByEmail, userSongRecord, saveLineScore, finishSong } from "./store.js";
import * as settings from "./settings.js";

// Modo Cantando: o aluno ouve a Mel no verso, canta, e o Gemini da nota de
// pronuncia/ritmo/entonacao a partir do audio. Letras originais da Mel ou de
// dominio publico (content/songs + data/songs); nada com direito autoral.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_DIR = path.join(ROOT, "data", "songs-audio");
const store = contentStore("songs");
const API = "https://generativelanguage.googleapis.com/v1beta/models";

// ---------- catalogo ----------

export function listSongs(includeInactive = false, language) {
  return store.list()
    .map((s) => ({ ...s, language: languageOf(s.language) }))
    .filter((s) => includeInactive || s.active !== false)
    .filter((s) => !language || s.language === language)
    .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.title.localeCompare(b.title));
}
const LEVEL_ORDER = ["A0", "A1", "A2", "B1", "B2", "C1"];

export function getSong(id) {
  const song = listSongs(true).find((s) => s.id === id);
  if (!song) throw Object.assign(new Error("musica nao encontrada"), { status: 404 });
  return song;
}

export function saveSong(song) {
  song.language = languageOf(song.language);
  if (!song.id) song.id = `${song.language}-${slugify(song.title) || "musica"}`.slice(0, 50);
  const clean = {
    id: song.id, language: song.language, title: String(song.title ?? "").slice(0, 80),
    artist: String(song.artist ?? "Mel").slice(0, 80), source: song.source === "dominio-publico" ? "dominio-publico" : "original",
    credit: song.credit ? String(song.credit).slice(0, 160) : undefined,
    level: LEVEL_ORDER.includes(song.level) ? song.level : "A1",
    focus: String(song.focus ?? "").slice(0, 240), description: String(song.description ?? "").slice(0, 240),
    style: String(song.style ?? "").slice(0, 300), icon: song.icon, active: song.active !== false,
    lines: (song.lines ?? []).filter((l) => l?.text).slice(0, 40).map((l) => ({
      text: String(l.text).slice(0, 140), pt: String(l.pt ?? "").slice(0, 200),
      ...(l.tip ? { tip: String(l.tip).slice(0, 240) } : {}), ...(l.section ? { section: String(l.section).slice(0, 20) } : {}),
    })),
  };
  if (!clean.title || clean.lines.length < 2) throw new Error("musica precisa de titulo e pelo menos 2 versos");
  return store.save(clean);
}

export function deleteSong(id) {
  store.remove(id);
  fs.rmSync(path.join(AUDIO_DIR, id), { recursive: true, force: true });
}

// ---------- chamadas de midia ao Gemini (REST: TTS e Lyria devolvem audio em inlineData) ----------

async function geminiRest(model, body, timeoutMs = 60000) {
  const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.get("GEMINI_API_KEY"))}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.error?.status ?? ""} ${json.error?.message ?? ""}`.trim());
  return json;
}

function audioPart(json) {
  return (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data)?.inlineData ?? null;
}

export function wavFromPcm16(pcm, sampleRate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ---------- voz da Mel em cada verso (gerada uma vez, guardada em data/) ----------

const inflight = new Map();

function lineFile(song, i) {
  const voice = settings.get("GEMINI_TTS_VOICE") || "Kore";
  const model = settings.get("GEMINI_TTS_MODEL");
  // o nome muda se o texto, a voz ou o modelo mudarem: editar o verso regera o audio
  const hash = crypto.createHash("sha1").update(`${song.lines[i].text}|${voice}|${model}|${song.language}`).digest("hex").slice(0, 10);
  return path.join(AUDIO_DIR, song.id, `line-${i}-${hash}.wav`);
}

export async function lineAudio(song, i) {
  const file = lineFile(song, i);
  if (fs.existsSync(file)) return file;
  if (inflight.has(file)) return inflight.get(file);
  const job = (async () => {
    const voice = settings.get("GEMINI_TTS_VOICE") || "Kore";
    const text = song.lines[i].text;
    // o verso vai PURO: qualquer instrucao de estilo ("diga devagar...") o modelo
    // le em voz alta junto (medido: 9-20 s de audio pra um verso de 6 palavras;
    // puro: ~3 s, natural). Reveza modelos porque cada um tem cota propria
    // (plano gratis: 3 pedidos por minuto por modelo).
    const models = [...new Set([settings.get("GEMINI_TTS_MODEL"), "gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"].filter(Boolean))];
    const part = await withRetry(async (model) => {
      const json = await geminiRest(model, {
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      });
      const p = audioPart(json);
      if (!p) throw new Error("503 TTS sem audio na resposta");
      return p;
    }, models);
    const raw = Buffer.from(part.data, "base64");
    const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1] ?? 24000);
    const wav = raw.subarray(0, 4).toString() === "RIFF" ? raw : wavFromPcm16(raw, rate);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // apaga versoes antigas deste verso (outra voz/texto)
    for (const f of fs.readdirSync(path.dirname(file))) if (f.startsWith(`line-${i}-`) && f !== path.basename(file)) fs.rmSync(path.join(path.dirname(file), f), { force: true });
    fs.writeFileSync(file, wav);
    return file;
  })();
  inflight.set(file, job);
  try { return await job; } finally { inflight.delete(file); }
}

// gera em segundo plano os versos que ainda nao tem audio, um por vez. Se bater
// na cota por minuto, espera e tenta de novo (ate 4x por verso) em vez de desistir.
const warming = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function warmSong(song) {
  if (warming.has(song.id)) return;
  warming.add(song.id);
  (async () => {
    for (let i = 0; i < song.lines.length; i++) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await lineAudio(song, i); break; } catch (err) {
          if (!/429|RESOURCE_EXHAUSTED|503/i.test(err.message) || attempt === 3) { console.error(`[musica] ${song.id} verso ${i}:`, err.message.slice(0, 160)); return; }
          await sleep(22000);
        }
      }
    }
  })().finally(() => warming.delete(song.id));
}

export function lineAudioReady(song) {
  return song.lines.map((_, i) => fs.existsSync(lineFile(song, i)));
}

// ---------- faixa completa (Lyria: instrumental + voz cantando a letra original) ----------

function trackMeta(id) {
  try { return JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, id, "track.json"), "utf-8")); } catch { return null; }
}

export function lyricsForMusic(song) {
  let section = null;
  const out = [];
  for (const l of song.lines) {
    if (l.section && l.section !== section) { section = l.section; out.push(`[${section}]`); }
    out.push(l.text);
  }
  return out.join("\n");
}

export async function generateTrack(song) {
  const model = settings.get("GEMINI_MUSIC_MODEL") || "lyria-3.5";
  const L = lang(song.language);
  const prompt = `${song.style || "Upbeat acoustic pop song, warm female vocal, about 95 bpm, simple catchy melody"}. Sung in ${L.code === "es" ? "Spanish" : "English"} with very clear diction for language learners. Original song, lyrics below.\n${lyricsForMusic(song)}`;
  let json;
  try {
    json = await geminiRest(model, { contents: [{ parts: [{ text: prompt }] }] }, 240000);
  } catch (err) {
    if (/429/.test(err.message) && /limit: 0|free_tier/i.test(err.message)) {
      throw new Error("o Lyria (música por IA) só funciona com faturamento ativo no Google AI Studio — no plano grátis o limite é zero");
    }
    if (/SAFETY|blocked|copyright/i.test(err.message)) throw new Error("o Lyria bloqueou essa letra (direito autoral ou imitação de artista)");
    throw err;
  }
  const part = audioPart(json);
  if (!part) throw new Error("o modelo de música não devolveu áudio");
  const ext = /mpeg|mp3/.test(part.mimeType) ? "mp3" : "wav";
  const dir = path.join(AUDIO_DIR, song.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = `track.${ext}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(part.data, "base64"));
  const meta = { file, mimeType: part.mimeType, model, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "track.json"), JSON.stringify(meta, null, 2));
  return meta;
}

// ---------- compor musica original com IA (painel) ----------

const SONG_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" }, focus: { type: "STRING" }, description: { type: "STRING" }, style: { type: "STRING" },
    lines: { type: "ARRAY", items: { type: "OBJECT", properties: { section: { type: "STRING" }, text: { type: "STRING" }, pt: { type: "STRING" }, tip: { type: "STRING" } }, required: ["section", "text", "pt"] } },
  },
  required: ["title", "focus", "description", "style", "lines"],
};

export async function composeSong({ language = "en", level = "A1", theme = "", focus = "" } = {}) {
  language = languageOf(language);
  const L = lang(language);
  if (!LEVEL_ORDER.includes(level)) throw new Error("nivel invalido (A0, A1, A2, B1, B2, C1)");
  const existing = listSongs(true, language).map((s) => s.title);
  const prompt = [
    `Voce compoe musicas ORIGINAIS da Mel, uma professora de ${L.name} brasileira, mal-humorada e engracada, pra alunos brasileiros aprenderem cantando.`,
    `Escreva uma musica nova em ${L.name}, nivel ${level}${focus ? `, ensinando: ${focus}` : ""}${theme ? `, sobre: ${theme}` : ""}.`,
    "REGRAS DE DIREITO AUTORAL (obrigatorias): letra 100% original. Nunca copie, cite ou parafraseie versos de musicas existentes, nunca mencione artistas, bandas ou titulos de musicas reais.",
    `Forma: 8 a 12 versos curtos e cantaveis (no maximo ${["A0", "A1"].includes(level) ? 7 : 10} palavras cada), com [Verse] e [Chorus] (o refrao repete o ponto gramatical). Vocabulario e gramatica do nivel ${level}. Humor leve e a cara da Mel sao bem-vindos.`,
    `Cada verso: "text" em ${L.name}, "pt" traducao natural em portugues do Brasil, "tip" (opcional, so em versos que valem) explicando em 1 frase a gramatica, a expressao ou o som que brasileiro erra ali. ${L.traps}`,
    `"focus": o que a musica ensina, em portugues, 1 frase. "description": chamada curta e divertida em portugues pra lista de musicas. "style": prompt em INGLES pra um gerador de musica: genero, clima, bpm, tipo de voz (sem citar artista nenhum).`,
    existing.length ? `Titulos que ja existem (nao repita): ${existing.join(" | ")}.` : "",
    "Responda somente com o JSON.",
  ].filter(Boolean).join("\n");
  const ai = (await import("@google/genai")).GoogleGenAI;
  const client = new ai({ apiKey: settings.get("GEMINI_API_KEY") });
  const res = await withRetry((model) => client.models.generateContent({
    model, contents: prompt, config: { responseMimeType: "application/json", responseSchema: SONG_SCHEMA, temperature: 1 },
  }));
  let song;
  try { song = JSON.parse(res.text); } catch { throw new Error("o modelo nao devolveu JSON valido"); }
  if (!song.title || !Array.isArray(song.lines) || song.lines.length < 4) throw new Error("musica gerada veio incompleta");
  return { ...song, language, level, artist: "Mel", source: "original", active: true };
}

export function adminSongView(s) {
  return { ...s, hasTrack: Boolean(trackMeta(s.id)), track: trackMeta(s.id), ready: lineAudioReady(s).filter(Boolean).length };
}

// ---------- nota do verso cantado ----------

const SCORE_SCHEMA = {
  type: "OBJECT",
  properties: {
    heard: { type: "STRING" }, pronunciation: { type: "INTEGER" }, rhythm: { type: "INTEGER" }, intonation: { type: "INTEGER" }, tip: { type: "STRING" },
  },
  required: ["heard", "pronunciation", "rhythm", "intonation", "tip"],
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

// palavras normalizadas (sem acento, pontuacao, maiuscula)
function words(text) {
  return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

// quanto da letra o aluno realmente cantou (0..1): fracao das palavras do verso
// que aparecem no que o modelo ouviu. O modelo as vezes da nota boa pra
// pronuncia de uma frase ERRADA (medido: verso trocado tirou 83) — essa conta
// e do servidor e nao depende dele.
export function lyricRecall(target, heard) {
  const want = words(target);
  const got = words(heard);
  if (!want.length) return 1;
  const pool = new Map();
  for (const w of got) pool.set(w, (pool.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want) {
    const n = pool.get(w) ?? 0;
    if (n > 0) { hit += 1; pool.set(w, n - 1); }
  }
  return hit / want.length;
}

export async function scoreLine(song, i, pcmBase64) {
  const L = lang(song.language);
  const line = song.lines[i];
  const wav = wavFromPcm16(Buffer.from(pcmBase64, "base64"), 16000);
  const prompt = [
    `Voce e a Mel, professora de ${L.name} mal-humorada mas justa, avaliando um aluno brasileiro que tentou cantar (ou falar no ritmo) este verso em ${L.name}: "${line.text}".`,
    `1) Em "heard", transcreva o que ele realmente disse.`,
    `2) Notas de 0 a 100: "pronunciation" (os sons de cada palavra e o sotaque), "rhythm" (fluidez, sem travar, no tempo de quem canta o verso) e "intonation" (melodia natural, sem soar robotico nem com a entonacao do portugues).`,
    `Se ele disse outra frase (palavras diferentes do verso), ficou mudo ou so tem ruido: TODAS as notas abaixo de 20, mesmo que a pronuncia do que ele disse esteja boa — a nota e sobre ESTE verso. Brasileiro que acertou as palavras com sotaque leve merece entre 70 e 85; quase nativo, 90 ou mais.`,
    `3) "tip": UMA dica em portugues do Brasil, no maximo 18 palavras, com a personalidade da Mel (deboche leve, sem palavrao), citando a palavra ou o som exato a ajustar. ${L.traps}`,
  ].join("\n");
  const ai = (await import("@google/genai")).GoogleGenAI;
  const client = new ai({ apiKey: settings.get("GEMINI_API_KEY") });
  const res = await withRetry((model) => client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } }, { text: prompt }] }],
    config: { responseMimeType: "application/json", responseSchema: SCORE_SCHEMA, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2 },
  }));
  const r = JSON.parse(res.text);
  // teto pela letra: 90%+ das palavras certas = sem teto; abaixo disso, a nota
  // nao passa da porcentagem de palavras cantadas
  const recall = lyricRecall(line.text, r.heard ?? "");
  const cap = recall >= 0.9 ? 100 : Math.round(recall * 100);
  const pronunciation = Math.min(clamp(r.pronunciation), cap), rhythm = Math.min(clamp(r.rhythm), cap), intonation = Math.min(clamp(r.intonation), cap);
  return {
    score: Math.round(pronunciation * 0.5 + rhythm * 0.25 + intonation * 0.25),
    pronunciation, rhythm, intonation, lyrics: Math.round(recall * 100),
    heard: String(r.heard ?? "").slice(0, 200), tip: String(r.tip ?? "").slice(0, 240),
  };
}

// ---------- rotas do app ----------

// token no header (fetch) ou em ?token= (tag <audio> nao manda header)
function auth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : String(req.query.token ?? "");
  try { req.user = verifyToken(token); next(); } catch { res.status(401).json({ error: "token invalido ou expirado" }); }
}

const scoresToday = new Map(); // "email|AAAA-MM-DD" -> quantas notas hoje (memoria basta)
function underDailyLimit(email) {
  const key = `${email}|${new Date().toISOString().slice(0, 10)}`;
  const n = (scoresToday.get(key) ?? 0) + 1;
  if (n > settings.getNumber("SONG_SCORES_PER_DAY", 150)) return false;
  scoresToday.set(key, n);
  if (scoresToday.size > 5000) for (const k of scoresToday.keys()) { if (!k.endsWith(key.slice(-10))) scoresToday.delete(k); }
  return true;
}

const publicSong = (s) => ({
  id: s.id, language: s.language, title: s.title, artist: s.artist, source: s.source, credit: s.credit,
  level: s.level, focus: s.focus, description: s.description, icon: s.icon, lineCount: s.lines.length,
  hasTrack: Boolean(trackMeta(s.id)),
});

export const router = express.Router();

router.get("/", auth, (req, res) => {
  const language = req.query.lang ? languageOf(String(req.query.lang)) : undefined;
  res.json(listSongs(false, language).map((s) => ({ ...publicSong(s), best: userSongRecord(req.user.email, s.id)?.best ?? null })));
});

router.get("/:id", auth, (req, res, next) => {
  try {
    const song = getSong(req.params.id);
    if (song.active === false) return res.status(404).json({ error: "musica nao encontrada" });
    warmSong(song); // ja comeca a gerar a voz dos proximos versos
    const rec = userSongRecord(req.user.email, song.id);
    res.json({ ...publicSong(song), lines: song.lines, ready: lineAudioReady(song), best: rec?.best ?? null, plays: rec?.plays ?? 0 });
  } catch (err) { next(err); }
});

router.get("/:id/line/:i", auth, async (req, res) => {
  try {
    const song = getSong(req.params.id);
    const i = Number(req.params.i);
    if (!Number.isInteger(i) || i < 0 || i >= song.lines.length) return res.status(404).end();
    const file = await lineAudio(song, i);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(file);
  } catch (err) {
    console.error("[musica] voz do verso:", err.message);
    res.status(503).json({ error: "a voz da Mel nao carregou agora" });
  }
});

router.get("/:id/track", auth, (req, res) => {
  try {
    const song = getSong(req.params.id);
    const meta = trackMeta(song.id);
    if (!meta) return res.status(404).end();
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(path.join(AUDIO_DIR, song.id, meta.file));
  } catch { res.status(404).end(); }
});

router.post("/:id/score", auth, async (req, res) => {
  try {
    const song = getSong(req.params.id);
    const i = Number(req.body?.line);
    const audio = String(req.body?.audio ?? "");
    if (!Number.isInteger(i) || i < 0 || i >= song.lines.length) return res.status(400).json({ error: "verso invalido" });
    const bytes = Math.floor(audio.length * 0.75);
    if (bytes < 16000 * 2 * 0.4) return res.status(400).json({ error: "não deu pra ouvir nada — canta mais perto do microfone" });
    if (bytes > 16000 * 2 * 20) return res.status(400).json({ error: "trecho longo demais" });
    const account = findUserByEmail(req.user.email);
    if (!account || account.blocked) return res.status(403).json({ error: "conta indisponivel" });
    if (!underDailyLimit(req.user.email)) return res.status(429).json({ error: "chega de cantar por hoje — volta amanhã" });
    const result = await scoreLine(song, i, audio);
    saveLineScore(req.user.email, song.id, i, result.score);
    res.json(result);
  } catch (err) {
    console.error("[musica] nota:", err.message);
    const busy = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE/i.test(err.message);
    res.status(busy ? 503 : 502).json({ error: busy ? "a Mel está com muita gente agora, tenta de novo em instantes" : "não consegui avaliar esse verso" });
  }
});

router.post("/:id/finish", auth, (req, res) => {
  try {
    const song = getSong(req.params.id);
    const result = finishSong(req.user.email, song.id, song.lines.length);
    if (!result) return res.status(400).json({ error: "canta pelo menos um verso antes" });
    res.json({ ...result, lineCount: song.lines.length });
  } catch (err) { res.status(err.status ?? 500).json({ error: err.message }); }
});
