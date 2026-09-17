import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
import { verifyToken } from "./auth.js";
import { getLesson, buildSystemInstruction } from "./lessons.js";
import { markLessonDone, findUserByEmail, logSession } from "./store.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-native-audio-preview-12-2025";

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

export function attachVoiceServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/voice" });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const lessonId = url.searchParams.get("lessonId");

    let user;
    try {
      user = verifyToken(token ?? "");
    } catch {
      safeSend(ws, { type: "error", message: "token invalido" });
      return ws.close();
    }

    let lesson;
    try {
      lesson = getLesson(lessonId ?? "");
    } catch {
      safeSend(ws, { type: "error", message: "licao invalida" });
      return ws.close();
    }

    const account = findUserByEmail(user.email);
    const profile = account?.profile ?? {};
    let geminiSession = null;
    let closedByClient = false;

    try {
      geminiSession = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: buildSystemInstruction(lesson, profile),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => safeSend(ws, { type: "ready" }),
          onmessage: (message) => {
            const parts = message?.serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                safeSend(ws, { type: "audio", data: part.inlineData.data });
              }
            }
            const inputText = message?.serverContent?.inputTranscription?.text;
            if (inputText) safeSend(ws, { type: "transcript", role: "aluno", text: inputText });

            const outputText = message?.serverContent?.outputTranscription?.text;
            if (outputText) safeSend(ws, { type: "transcript", role: "tutora", text: outputText });

            if (message?.serverContent?.turnComplete) {
              safeSend(ws, { type: "turnComplete" });
            }
          },
          onerror: (err) => safeSend(ws, { type: "error", message: err?.message ?? "erro na sessao de voz" }),
          onclose: () => {
            if (!closedByClient) safeSend(ws, { type: "error", message: "sessao de voz encerrada" });
          },
        },
      });
    } catch (err) {
      safeSend(ws, { type: "error", message: `falha ao conectar com a IA: ${err.message}` });
      return ws.close();
    }

    // a Mel abre a aula sozinha, sem esperar o aluno falar primeiro
    const firstName = (account?.name ?? "").trim().split(" ")[0];
    geminiSession.sendClientContent({
      turns: [{ role: "user", parts: [{ text: `(${firstName ? `O aluno ${firstName}` : "O aluno"} acabou de entrar na aula. Comece voce, em portugues, do seu jeito.)` }] }],
      turnComplete: true,
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "audio" && msg.data) {
        geminiSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
        });
      } else if (msg.type === "audioStreamEnd") {
        geminiSession.sendRealtimeInput({ audioStreamEnd: true });
      } else if (msg.type === "lessonDone") {
        markLessonDone(user.email, lesson.id);
      }
    });

    const startedAt = Date.now();
    ws.on("close", () => {
      closedByClient = true;
      geminiSession?.close();
      logSession({
        email: user.email,
        lessonId: lesson.id,
        startedAt: new Date(startedAt).toISOString(),
        seconds: Math.round((Date.now() - startedAt) / 1000),
      });
    });
  });

  return wss;
}
