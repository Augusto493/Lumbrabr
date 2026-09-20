import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import { router as authRouter } from "./auth.js";
import { router as lessonsRouter } from "./lessons.js";
import { router as adminRouter } from "./admin.js";
import { router as payRouter, handleWebhook } from "./pay.js";
import { router as viralRouter } from "./viral.js";
import { attachVoiceServer } from "./voice.js";
import { rateLimit } from "./ratelimit.js";
import { securityHeaders, gzip } from "./http-extras.js";
import * as settings from "./settings.js";

// estes dois precisam existir no primeiro boot (vem do .env); depois disso
// tambem podem ser trocados pelo painel em Configuracoes, sem reiniciar
for (const key of ["JWT_SECRET", "GEMINI_API_KEY"]) {
  if (!settings.has(key)) {
    console.error(`Faltando variavel de ambiente ${key}. Copie .env.example para .env e preencha.`);
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // atras do Traefik: req.ip vem do X-Forwarded-For

app.use(securityHeaders);
app.use(gzip);

// o webhook precisa do corpo cru pra conferir a assinatura, por isso vem antes do json()
app.post("/api/pay/webhook", express.text({ type: "*/*", limit: "1mb" }), handleWebhook);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public"), {
  etag: true,
  maxAge: 0,
  setHeaders(res, file) {
    // clipes de voz e imagens mudam raramente: um dia de cache no navegador
    if (/[\\/]audio[\\/]|\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(file)) res.setHeader("Cache-Control", "public, max-age=86400");
  },
}));

app.use("/api/auth", rateLimit({ windowMs: 10 * 60000, max: 40, message: "muitas tentativas de login/cadastro, espera 10 minutos" }), authRouter);
app.use("/api/lessons", lessonsRouter);
app.use("/api/admin/login", rateLimit({ windowMs: 10 * 60000, max: 10 }));
app.use("/api/admin", adminRouter);
app.use("/api/pay", payRouter);
app.use("/api/viral", express.json({ limit: "5mb" }), rateLimit({ windowMs: 60 * 60000, max: 60 }), viralRouter);
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// erro inesperado numa rota: responde 500 em JSON em vez de derrubar a conexao
app.use((err, _req, res, _next) => {
  console.error("[http]", err?.message ?? err);
  if (res.headersSent) return;
  res.status(err?.status ?? 500).json({ error: err?.type === "entity.too.large" ? "arquivo grande demais" : "erro interno" });
});

process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
process.on("uncaughtException", (err) => { console.error("[uncaughtException]", err); process.exit(1); }); // o Docker reinicia

const server = http.createServer(app);
server.keepAliveTimeout = 65000; // maior que o do Traefik, evita conexao cortada no meio
attachVoiceServer(server);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`ingles-ai rodando em http://localhost:${port}`));
