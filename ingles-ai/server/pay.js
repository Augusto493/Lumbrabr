import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "./auth.js";
import { findUserByEmail, updateUser, getPlans, saveOrder, findOrder, minutesUsedToday, countPromoUsers } from "./store.js";
import * as pagbank from "./pagbank.js";
import * as settings from "./settings.js";

const PIX_EXPIRATION_MIN = 30;

function freeMinutesPerDay() {
  return settings.getNumber("FREE_MINUTES_PER_DAY", 3);
}

function publicUrl() {
  return String(settings.get("PUBLIC_URL") ?? "").replace(/\/$/, "");
}

export const router = express.Router();

// prioridade: plano pago > promocao de lancamento > cota gratis.
// bonusMinutes e um saldo a parte (indicacoes/missoes) que entra quando a cota do dia acaba.
export function entitlement(account) {
  const now = new Date();
  const bonusMinutes = Math.max(0, Number(account?.bonusMinutes ?? 0));
  const plan = account?.plan;
  if (plan && new Date(plan.expiresAt) > now) {
    return { free: false, kind: "plan", planId: plan.id, planName: plan.name, minutesPerDay: plan.minutesPerDay, expiresAt: plan.expiresAt, bonusMinutes };
  }
  const promo = account?.promo;
  if (promo && new Date(promo.expiresAt) > now) {
    return { free: false, kind: "promo", planId: "promo", planName: promo.name, minutesPerDay: promo.minutesPerDay, expiresAt: promo.expiresAt, bonusMinutes };
  }
  return { free: true, kind: "free", planId: null, planName: "grátis", minutesPerDay: freeMinutesPerDay(), expiresAt: null, bonusMinutes };
}

// segundos que a pessoa ainda pode conversar agora: o que sobrou da cota do dia + saldo bonus
export function remainingSeconds(account, usedTodayMin) {
  const ent = entitlement(account);
  const daily = Math.max(0, ent.minutesPerDay - usedTodayMin);
  return Math.round((daily + ent.bonusMinutes) * 60);
}

export function launchPromo() {
  const enabled = settings.get("LAUNCH_PROMO_ENABLED") !== "nao";
  const slots = settings.getNumber("LAUNCH_PROMO_SLOTS", 0);
  const used = countPromoUsers();
  return {
    enabled, slots, used, slotsLeft: Math.max(0, slots - used),
    minutesPerDay: settings.getNumber("LAUNCH_PROMO_MINUTES", 3),
    days: settings.getNumber("LAUNCH_PROMO_DAYS", 30),
    name: settings.get("LAUNCH_PROMO_NAME") || "Lançamento",
  };
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
  const promo = launchPromo();
  res.json({
    plans: getPlans().filter((p) => p.active), pixConfigured: pagbank.isConfigured(), freeMinutesPerDay: freeMinutesPerDay(),
    launch: { enabled: promo.enabled && promo.slotsLeft > 0, slotsLeft: promo.slotsLeft, slots: promo.slots, minutesPerDay: promo.minutesPerDay, days: promo.days },
  });
});

router.get("/me", requireAuth, (req, res) => {
  const account = findUserByEmail(req.user.email);
  const ent = entitlement(account);
  const usedToday = Math.round(minutesUsedToday(req.user.email) * 10) / 10;
  res.json({ ...ent, usedToday, remainingSeconds: remainingSeconds(account, usedToday) });
});

router.post("/pix", requireAuth, async (req, res) => {
  if (!pagbank.isConfigured()) return res.status(503).json({ error: "pagamento por Pix ainda nao configurado (configure em Painel > Configurações > Pagamento)" });
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
      notificationUrl: publicUrl().startsWith("https://") ? `${publicUrl()}/api/pay/webhook` : undefined,
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
  if (order.status !== "PAID" && pagbank.isConfigured() && Date.now() - (order.lastCheck ?? 0) > 3000) {
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
