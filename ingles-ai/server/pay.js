import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "./auth.js";
import { findUserByEmail, updateUser, getPlans, saveOrder, findOrder, getOrders, minutesUsedToday, countPromoUsers } from "./store.js";
import * as abacate from "./abacatepay.js";
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
    plans: getPlans().filter((p) => p.active), pixConfigured: abacate.isConfigured(), freeMinutesPerDay: freeMinutesPerDay(),
    launch: { enabled: promo.enabled && promo.slotsLeft > 0, slotsLeft: promo.slotsLeft, slots: promo.slots, minutesPerDay: promo.minutesPerDay, days: promo.days },
  });
});

router.get("/me", requireAuth, (req, res) => {
  const account = findUserByEmail(req.user.email);
  const ent = entitlement(account);
  const usedToday = Math.round(minutesUsedToday(req.user.email) * 10) / 10;
  res.json({ ...ent, usedToday, remainingSeconds: remainingSeconds(account, usedToday) });
});

const FINAL_STATUSES = ["EXPIRED", "CANCELLED", "CANCELED", "FAILED", "REFUNDED"];

// gera o Pix na AbacatePay: sem pedir CPF/telefone (opcionais na API), um toque so
router.post("/pix", requireAuth, async (req, res) => {
  if (!abacate.isConfigured()) return res.status(503).json({ error: "pagamento por Pix ainda nao configurado (Painel > Configurações > Pagamento)" });
  const { planId } = req.body ?? {};
  const plan = getPlans().find((p) => p.id === planId && p.active);
  if (!plan) return res.status(400).json({ error: "plano invalido" });

  const referenceId = `mel-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  try {
    const pix = await abacate.createPix({
      amountCents: plan.priceCents,
      description: `Mel — ${plan.name} (${plan.days} dias)`,
      expiresInSec: PIX_EXPIRATION_MIN * 60,
      externalId: referenceId,
      metadata: { externalId: referenceId, email: req.user.email, planId: plan.id },
    });
    const order = saveOrder({
      id: pix.id, referenceId, email: req.user.email, planId: plan.id, planName: plan.name,
      amountCents: plan.priceCents, status: pix.status, qrText: pix.brCode, qrPng: pix.brCodeBase64, devMode: pix.devMode,
      createdAt: new Date().toISOString(), expiresAt: pix.expiresAt ?? new Date(Date.now() + PIX_EXPIRATION_MIN * 60000).toISOString(),
      paidAt: null, lastCheck: 0,
    });
    res.json({ orderId: order.id, status: order.status, amountCents: order.amountCents, qrText: order.qrText, qrPng: order.qrPng, expiresAt: order.expiresAt, devMode: order.devMode });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// consulta o status na AbacatePay e libera o plano se pagou (usado pelo app a cada 4 s)
async function refreshOrder(order) {
  const remote = await abacate.check(order.id);
  const updated = saveOrder({ ...order, status: remote.status, lastCheck: Date.now(), paidAt: remote.status === "PAID" ? order.paidAt ?? new Date().toISOString() : order.paidAt });
  if (remote.status === "PAID" && order.status !== "PAID") activateOrder(updated);
  return findOrder(order.id) ?? updated;
}

router.get("/status/:orderId", requireAuth, async (req, res) => {
  let order = findOrder(req.params.orderId);
  if (!order || order.email !== req.user.email) return res.status(404).json({ error: "pedido nao encontrado" });
  if (order.status !== "PAID" && !FINAL_STATUSES.includes(order.status) && abacate.isConfigured() && Date.now() - (order.lastCheck ?? 0) > 3000) {
    try { order = await refreshOrder(order); }
    catch (err) { order = saveOrder({ ...order, lastCheck: Date.now(), lastError: err.message }); }
  }
  res.json({ status: order.status, entitlement: entitlement(findUserByEmail(req.user.email)) });
});

// so em Dev mode (chave de teste): "paga" o Pix sem dinheiro de verdade
router.post("/simulate/:orderId", requireAuth, async (req, res) => {
  const order = findOrder(req.params.orderId);
  if (!order || order.email !== req.user.email) return res.status(404).json({ error: "pedido nao encontrado" });
  if (!order.devMode) return res.status(400).json({ error: "simulacao so existe em modo de teste" });
  try {
    await abacate.simulatePayment(order.id);
    const updated = await refreshOrder(order);
    res.json({ status: updated.status, entitlement: entitlement(findUserByEmail(req.user.email)) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Webhook da AbacatePay (?webhookSecret=...). O status e sempre reconfirmado na
// API antes de liberar o plano, entao o corpo do evento so serve pra achar o pedido.
export async function handleWebhook(req, res) {
  if (!abacate.verifyWebhook(req)) return res.status(401).end();
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const id = abacate.idFromWebhook(payload);
  let order = id ? findOrder(id) : null;
  if (!order) {
    const ext = abacate.externalIdFromWebhook(payload);
    order = ext ? getOrders().find((o) => o.referenceId === ext) ?? null : null;
  }
  if (!order) return res.status(200).end();
  try {
    if (order.status !== "PAID") await refreshOrder(order);
  } catch (err) {
    saveOrder({ ...order, lastError: err.message });
  }
  res.status(200).end();
}
