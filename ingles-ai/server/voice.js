import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
import { verifyToken } from "./auth.js";
import { getLesson, buildSystemInstruction } from "./lessons.js";
import { markLessonDone, findUserByEmail, logSession, minutesUsedToday } from "./store.js";
import { entitlement } from "./pay.js";
import * as settings from "./settings.js";

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
    if (account?.blocked) {
      safeSend(ws, { type: "error", message: "conta bloqueada" });
      return ws.close();
    }

    // limite diario de minutos: plano ativo ou cota gratis
    const ent = entitlement(account);
    const remainingSec = Math.max(0, Math.round(ent.minutesPerDay * 60 - minutesUsedToday(user.email) * 60));
    if (remainingSec < 20) {
      safeSend(ws, { type: "limit", ...ent });
      return ws.close();
    }

    let geminiSession = null;
    let closedByClient = false;
    const limiter = setTimeout(() => {
      safeSend(ws, { type: "limit", ...ent });
      ws.close();
    }, remainingSec * 1000);

    try {
      const ai = new GoogleGenAI({ apiKey: settings.get("GEMINI_API_KEY") });
      geminiSession = await ai.live.connect({
        model: settings.get("GEMINI_LIVE_MODEL"),
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

            // o aluno falou por cima da Mel: o app descarta o audio que ainda ia tocar
            if (message?.serverContent?.interrupted) {
              safeSend(ws, { type: "interrupted" });
            }
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
      turns: [{ role: "user", parts: [{ text: `(${firstName ? `O aluno ${firstName}` : "O aluno"} acabou de entrar na aula. O microfone dele ja esta aberto. Comece voce, em portugues, do seu jeito, e termine com uma pergunta curta pra ele responder.)` }] }],
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
      clearTimeout(limiter);
      geminiSession?.close();
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      // a tela de aula nao tem botao de "concluir": uma conversa de pelo menos
      // 90 s conta como licao feita
      if (seconds >= 90) markLessonDone(user.email, lesson.id);
      logSession({
        email: user.email,
        lessonId: lesson.id,
        startedAt: new Date(startedAt).toISOString(),
        seconds,
      });
    });
  });

  return wss;
}
