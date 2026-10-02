import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
import { verifyToken } from "./auth.js";
import { getLesson, buildSystemInstruction } from "./lessons.js";
import { markLessonDone, findUserByEmail, logSession, minutesUsedToday, addBonusMinutes } from "./store.js";
import { entitlement, remainingSeconds } from "./pay.js";
import { creditReferralForFirstLesson } from "./viral.js";
import * as settings from "./settings.js";

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

// sessoes de voz abertas agora (teto configuravel: MAX_CONCURRENT_VOICE)
let activeSessions = 0;
export function activeVoiceSessions() { return activeSessions; }

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

    // limite diario de minutos: plano/promocao/cota gratis + saldo bonus
    const ent = entitlement(account);
    const usedBeforeMin = minutesUsedToday(user.email);
    const remainingSec = remainingSeconds(account, usedBeforeMin);
    if (remainingSec < 20) {
      safeSend(ws, { type: "limit", ...ent });
      return ws.close();
    }

    // teto de conversas simultaneas: melhor avisar "ocupada" do que estourar a API
    if (activeSessions >= settings.getNumber("MAX_CONCURRENT_VOICE", 20)) {
      safeSend(ws, { type: "busy", message: "a Mel está com muita gente agora. Tenta de novo em 1 minuto." });
      return ws.close();
    }
    activeSessions += 1;
    let released = false;
    const release = () => { if (!released) { released = true; activeSessions = Math.max(0, activeSessions - 1); } };

    let geminiSession = null;
    let closedByClient = false;
    let rekicked = false;
    const stats = { audioIn: 0, audioOut: 0, turns: 0, stalls: 0 };
    // Vigia de travamento: o fim de fala e sinalizado explicitamente pelo cliente
    // (activityEnd), nao mais por deteccao automatica de silencio no audio — numa
    // rede instavel entre a VPS e o Google, pacotes atrasados/perdidos podiam
    // fazer o detector automatico nunca "fechar" o turno, e a conversa travava
    // sem erro nenhum (medido em producao: ~1 a cada 4 conversas ficava muda).
    // Se 7s depois de activityEnd nada chegar, avisa o cliente pra ele se recuperar.
    let stallTimer = null;
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stats.stalls++;
        safeSend(ws, { type: "stall" });
      }, 7000);
    };
    const clearStall = () => clearTimeout(stallTimer);
    const firstName = (account?.name ?? "").trim().split(" ")[0];
    const kickoffText = `${firstName ? `O aluno ${firstName}` : "O aluno"} acabou de entrar na aula. O microfone dele ja esta aberto. Abra voce, em portugues, em NO MAXIMO duas frases curtas, e ja dite a primeira frase pra ele repetir. Nada de discurso: cumprimenta, situa a cena numa frase e passa a frase.`;
    const limiter = setTimeout(() => {
      safeSend(ws, { type: "limit", ...ent });
      ws.close();
    }, remainingSec * 1000);
    // mantem a conexao viva atraves de proxies que cortam WebSocket ocioso
    const pinger = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, 25000);
    ws.on("error", () => {});

    try {
      const ai = new GoogleGenAI({ apiKey: settings.get("GEMINI_API_KEY") });
      geminiSession = await ai.live.connect({
        model: settings.get("GEMINI_LIVE_MODEL"),
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: buildSystemInstruction(lesson, profile),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // sem "pensar" antes de falar: numa conversa por voz cada segundo de
          // silencio parece travamento (medido: ~5 s ate a primeira palavra com o padrao)
          thinkingConfig: { thinkingBudget: 0 },
          // deteccao automatica de fala DESLIGADA: o navegador ja sabe com precisao
          // quando o aluno comeca/para de falar (porta de voz por volume) e manda
          // isso explicito (activityStart/activityEnd). Depender do Gemini detectar
          // silencio dentro do audio recebido falhava sob rede instavel.
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        },
        callbacks: {
          onopen: () => safeSend(ws, { type: "ready" }),
          onmessage: (message) => {
            const parts = message?.serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                stats.audioOut++;
                clearStall();
                safeSend(ws, { type: "audio", data: part.inlineData.data });
              }
            }
            const inputText = message?.serverContent?.inputTranscription?.text;
            if (inputText) safeSend(ws, { type: "transcript", role: "aluno", text: inputText });

            const outputText = message?.serverContent?.outputTranscription?.text;
            if (outputText) safeSend(ws, { type: "transcript", role: "tutora", text: outputText });

            // o aluno falou por cima da Mel: o app descarta o audio que ainda ia tocar
            if (message?.serverContent?.interrupted) {
              clearStall();
              safeSend(ws, { type: "interrupted" });
            }
            if (message?.serverContent?.turnComplete) {
              clearStall();
              stats.turns++;
              // alguns modelos respondem ao empurrao de abertura so em texto (sem audio):
              // da um segundo empurrao por outro canal pra Mel falar de verdade
              if (stats.turns === 1 && stats.audioOut === 0 && !rekicked) {
                rekicked = true;
                try { geminiSession.sendRealtimeInput({ text: `[sistema: ${kickoffText}]` }); } catch {}
                return;
              }
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
      release();
      clearTimeout(limiter);
      clearInterval(pinger);
      const msg = /429|quota|RESOURCE_EXHAUSTED/i.test(err.message) ? "a Mel está com muita gente agora. Tenta de novo em 1 minuto." : `falha ao conectar com a IA: ${err.message}`;
      safeSend(ws, { type: "error", message: msg });
      return ws.close();
    }

    // a Mel abre a aula sozinha, sem esperar o aluno falar primeiro
    geminiSession.sendClientContent({
      turns: [{ role: "user", parts: [{ text: `(${kickoffText})` }] }],
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
        stats.audioIn++;
        geminiSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
        });
      } else if (msg.type === "activityStart") {
        clearStall();
        try { geminiSession.sendRealtimeInput({ activityStart: {} }); } catch {}
      } else if (msg.type === "activityEnd" || msg.type === "audioStreamEnd") {
        // audioStreamEnd (nome antigo) so chega de uma aba que ja estava aberta
        // antes do deploy — sem o activityStart correspondente o turno nao fecha
        // de jeito nenhum; o vigia de travamento entra em acao e recarregar a
        // pagina resolve (pega o app.js novo, que manda os dois sinais certos)
        try { geminiSession.sendRealtimeInput({ activityEnd: {} }); } catch {}
        armStall();
      } else if (msg.type === "lessonDone") {
        markLessonDone(user.email, lesson.id);
      }
    });

    const startedAt = Date.now();
    ws.on("close", () => {
      closedByClient = true;
      clearTimeout(limiter);
      clearInterval(pinger);
      clearStall();
      release();
      try { geminiSession?.close(); } catch {}
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      // resumo no log do container: ajuda a ver de longe se o audio do aluno esta chegando
      // e se a sessao travou (stalls > 0) mesmo com audio chegando dos dois lados
      console.log(`[voz] ${user.email} ${lesson.id} ${seconds}s | audio aluno ${stats.audioIn} chunks | audio Mel ${stats.audioOut} chunks | turnos ${stats.turns} | travamentos ${stats.stalls} | simultaneas ${activeSessions}`);
      // a tela de aula nao tem botao de "concluir": uma conversa de pelo menos
      // 90 s conta como licao feita (e libera o bonus de quem indicou, na primeira)
      if (seconds >= 90) {
        markLessonDone(user.email, lesson.id);
        try { creditReferralForFirstLesson(user.email); } catch (err) { console.error("[viral]", err.message); }
      }
      // o que passou da cota do dia sai do saldo bonus
      const usedAfterMin = usedBeforeMin + seconds / 60;
      const overflow = Math.max(0, usedAfterMin - ent.minutesPerDay) - Math.max(0, usedBeforeMin - ent.minutesPerDay);
      if (overflow > 0 && ent.bonusMinutes > 0) addBonusMinutes(user.email, -Math.min(overflow, ent.bonusMinutes), "usado na conversa");
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
