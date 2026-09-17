import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import { router as authRouter } from "./auth.js";
import { router as lessonsRouter } from "./lessons.js";
import { router as adminRouter } from "./admin.js";
import { router as payRouter, handleWebhook } from "./pay.js";
import { attachVoiceServer } from "./voice.js";

for (const key of ["JWT_SECRET", "GEMINI_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`Faltando variavel de ambiente ${key}. Copie .env.example para .env e preencha.`);
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// o webhook precisa do corpo cru pra conferir a assinatura, por isso vem antes do json()
app.post("/api/pay/webhook", express.text({ type: "*/*", limit: "1mb" }), handleWebhook);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/auth", authRouter);
app.use("/api/lessons", lessonsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/pay", payRouter);
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
attachVoiceServer(server);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`ingles-ai rodando em http://localhost:${port}`));
