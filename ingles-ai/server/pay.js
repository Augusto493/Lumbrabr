import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "./auth.js";
import { findUserByEmail, updateUser, getPlans, saveOrder, findOrder, minutesUsedToday } from "./store.js";
import * as pagbank from "./pagbank.js";

const FREE_MINUTES_PER_DAY = Number(process.env.FREE_MINUTES_PER_DAY ?? 3);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
const PIX_EXPIRATION_MIN = 30;

export const router = express.Router();

export function entitlement(account) {
  const plan = account?.plan;
  if (plan && new Date(plan.expiresAt) > new Date()) {
    return { free: false, planId: plan.id, planName: plan.name, minutesPerDay: plan.minutesPerDay, expiresAt: plan.expiresAt };
  }
  return { free: true, planId: null, planName: "grátis", minutesPerDay: FREE_MINUTES_PER_DAY, expiresAt: null };
}

export function activateOrder(order) {
  const plan = getPlans().find((p) => p.id === order.planId);
  const user = findUserByEmail(order.email);
  if (!plan || !user) return null;
  const now = new Date();
  const current = user.plan && new Date(user.plan.expiresAt) > now && user.plan.id === plan.id ? new Date(user.plan.expiresAt) : now;
  const expiresAt = new Date(current.getTime() + plan.days * 86400000).toISOString();
  updateUser(order.email, { plan: { id: plan.id, name: plan.name, minutesPerDay: plan.minutesPerDay, activatedAt: now.toISOString(), expiresAt } });
  saveOrder({ ...order, status: "PAID", paidAt: order.paidAt ?? now.toISOString() });
  return expiresAt;
}

router.get("/plans", (_req, res) => {
  res.json({ plans: getPlans().filter((p) => p.active), pixConfigured: pagbank.configured, freeMinutesPerDay: FREE_MINUTES_PER_DAY });
});

router.get("/me", requireAuth, (req, res) => {
  const account = findUserByEmail(req.user.email);
  const ent = entitlement(account);
  res.json({ ...ent, usedToday: Math.round(minutesUsedToday(req.user.email) * 10) / 10 });
});

router.post("/pix", requireAuth, async (req, res) => {
  if (!pagbank.configured) return res.status(503).json({ error: "pagamento por Pix ainda nao configurado (PAGBANK_TOKEN no .env)" });
  const { planId, name, cpf, phone } = req.body ?? {};
  const plan = getPlans().find((p) => p.id === planId && p.active);
  if (!plan) return res.status(400).json({ error: "plano invalido" });
  const taxId = String(cpf ?? "").replace(/\D/g, "");
  const phoneDigits = String(phone ?? "").replace(/\D/g, "");
  if (taxId.length !== 11) return res.status(400).json({ error: "CPF precisa ter 11 digitos" });
  if (phoneDigits.length < 10 || phoneDigits.length > 11) return res.status(400).json({ error: "celular com DDD, ex: 11999998888" });
  if (!name || String(name).trim().length < 3) return res.status(400).json({ error: "nome completo obrigatorio" });

  const referenceId = `mel-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const expiresAt = new Date(Date.now() + PIX_EXPIRATION_MIN * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
  try {
    const created = await pagbank.createPixOrder({
      referenceId,
      customer: {
        name: String(name).trim(),
        email: req.user.email,
        tax_id: taxId,
        phones: [{ country: "55", area: phoneDigits.slice(0, 2), number: phoneDigits.slice(2), type: "MOBILE" }],
      },
      itemName: `Mel — ${plan.name} (${plan.days} dias)`,
      amountCents: plan.priceCents,
      expiresAt,
      notificationUrl: PUBLIC_URL.startsWith("https://") ? `${PUBLIC_URL}/api/pay/webhook` : undefined,
    });
    const pix = pagbank.extractPix(created);
    const order = saveOrder({
      id: created.id, referenceId, chargeId: pix.chargeId, email: req.user.email, planId: plan.id, planName: plan.name,
      amountCents: plan.priceCents, status: pix.status, qrText: pix.qrText, qrPng: pix.qrPng,
      createdAt: new Date().toISOString(), expiresAt, paidAt: null, lastCheck: 0,
    });
    res.json({ orderId: order.id, status: order.status, amountCents: order.amountCents, qrText: order.qrText, qrPng: order.qrPng, expiresAt });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/status/:orderId", requireAuth, async (req, res) => {
  let order = findOrder(req.params.orderId);
  if (!order || order.email !== req.user.email) return res.status(404).json({ error: "pedido nao encontrado" });
  if (order.status !== "PAID" && pagbank.configured && Date.now() - (order.lastCheck ?? 0) > 3000) {
    try {
      const remote = await pagbank.getOrder(order.id);
      const pix = pagbank.extractPix(remote);
      order = saveOrder({ ...order, status: pix.status, paidAt: pix.paidAt ?? order.paidAt, lastCheck: Date.now() });
      if (pix.status === "PAID") activateOrder(order);
    } catch (err) {
      order = saveOrder({ ...order, lastCheck: Date.now(), lastError: err.message });
    }
  }
  res.json({ status: order.status, entitlement: entitlement(findUserByEmail(req.user.email)) });
});

// PagBank envia o pedido completo; a assinatura e conferida e o status e
// reconfirmado na API antes de liberar o plano
export async function handleWebhook(req, res) {
  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  if (!pagbank.verifySignature(raw, req.get("x-authenticity-token"))) return res.status(401).end();
  let payload;
  try { payload = JSON.parse(raw); } catch { return res.status(400).end(); }
  const order = findOrder(payload.id);
  if (!order) return res.status(200).end();
  try {
    const remote = await pagbank.getOrder(order.id);
    const pix = pagbank.extractPix(remote);
    const updated = saveOrder({ ...order, status: pix.status, paidAt: pix.paidAt ?? order.paidAt, lastCheck: Date.now() });
    if (pix.status === "PAID" && order.status !== "PAID") activateOrder(updated);
  } catch (err) {
    saveOrder({ ...order, lastError: err.message });
  }
  res.status(200).end();
}
