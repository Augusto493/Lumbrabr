import crypto from "node:crypto";
import * as settings from "./settings.js";

// AbacatePay — Pix por "checkout transparente" (v2/transparents).
// Uma chave so: criada em Dev mode gera cobrancas simuladas (devMode: true nas
// respostas, pagamento pode ser simulado); criada em producao cobra de verdade.
// Docs: https://docs.abacatepay.com/pages/transparents/create

export function isConfigured() {
  return settings.has("ABACATEPAY_API_KEY");
}

function baseUrl() {
  return String(settings.get("ABACATEPAY_BASE_URL") || process.env.ABACATEPAY_BASE_URL || "https://api.abacatepay.com").replace(/\/$/, "");
}

async function call(method, route, body) {
  const res = await fetch(baseUrl() + route, {
    method,
    headers: { Authorization: `Bearer ${settings.get("ABACATEPAY_API_KEY")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json.success === false || json.error) {
    const detail = typeof json.error === "string" ? json.error : json.error?.message ?? json.message ?? text.slice(0, 200);
    throw new Error(`AbacatePay ${res.status}: ${detail}`);
  }
  return json.data ?? json;
}

export function normalize(data) {
  return {
    id: data.id ?? null,
    status: String(data.status ?? "PENDING").toUpperCase(),
    brCode: data.brCode ?? null,
    brCodeBase64: data.brCodeBase64 ?? null,
    expiresAt: data.expiresAt ?? null,
    devMode: Boolean(data.devMode),
    amountCents: data.amount ?? null,
  };
}

export async function createPix({ amountCents, description, expiresInSec, externalId, metadata }) {
  const data = await call("POST", "/v2/transparents/create", {
    method: "PIX",
    data: { amount: amountCents, description, expiresIn: expiresInSec, externalId, metadata },
  });
  return normalize(data);
}

export async function check(id) {
  return normalize(await call("GET", `/v2/transparents/check?id=${encodeURIComponent(id)}`));
}

// so funciona com chave de Dev mode
export async function simulatePayment(id) {
  return normalize(await call("POST", `/v2/transparents/simulate-payment?id=${encodeURIComponent(id)}`, {}));
}

// o webhook chega com ?webhookSecret=<segredo definido no painel da AbacatePay>
export function verifyWebhook(req) {
  const secret = settings.get("ABACATEPAY_WEBHOOK_SECRET");
  const given = String(req.query?.webhookSecret ?? "");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// tira o id da cobranca do corpo do webhook, seja qual for o formato do evento
export function idFromWebhook(payload) {
  const d = payload?.data ?? {};
  return d.transparent?.id ?? d.pixQrCode?.id ?? d.checkout?.id ?? d.billing?.id ?? d.id ?? null;
}

export function externalIdFromWebhook(payload) {
  const d = payload?.data ?? {};
  const obj = d.transparent ?? d.pixQrCode ?? d.checkout ?? d.billing ?? d;
  return obj?.externalId ?? obj?.metadata?.externalId ?? null;
}
