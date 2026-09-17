import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getUsers, getProgress, getSessions, findUserByEmail, updateUser, deleteUser, getPlans, savePlans, getOrders } from "./store.js";
import { listLessons, getLesson, saveLesson, deleteLesson } from "./lessons.js";
import { generateLesson } from "./generate.js";
import { entitlement } from "./pay.js";
import * as pagbank from "./pagbank.js";

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COST_PER_MINUTE_BRL = 0.07;
const PROFILE_KEYS = ["voiceMode", "level", "blocker", "tone"];

export const router = express.Router();

function samePassword(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// duas portas de entrada: a conta de um usuario cujo e-mail esta em ADMIN_EMAIL
// (token normal do app, com role admin) ou a senha unica ADMIN_PASSWORD
router.post("/login", (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "defina ADMIN_PASSWORD (ou ADMIN_EMAIL) no .env para liberar o painel" });
  const { password } = req.body ?? {};
  if (!samePassword(password ?? "", ADMIN_PASSWORD)) return res.status(401).json({ error: "senha invalida" });
  res.json({ token: jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" }) });
});

function requireAdmin(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (jwt.verify(token, JWT_SECRET).role !== "admin") throw new Error();
    next();
  } catch {
    res.status(401).json({ error: "acesso negado" });
  }
}

router.use(requireAdmin);

const dayKey = (iso) => String(iso ?? "").slice(0, 10);

// ---------- visao geral ----------

router.get("/stats", (_req, res) => {
  const users = Object.values(getUsers());
  const progress = getProgress();
  const sessions = getSessions();
  const lessons = listLessons(true);
  const orders = getOrders();
  const today = dayKey(new Date().toISOString());
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const minutesByEmail = {};
  const lastSeenByEmail = {};
  const perLesson = Object.fromEntries(lessons.map((l) => [l.id, { id: l.id, title: l.title, level: l.level, active: l.active !== false, completions: 0, minutes: 0, sessions: 0 }]));
  for (const s of sessions) {
    const min = s.seconds / 60;
    minutesByEmail[s.email] = (minutesByEmail[s.email] ?? 0) + min;
    if (!lastSeenByEmail[s.email] || s.startedAt > lastSeenByEmail[s.email]) lastSeenByEmail[s.email] = s.startedAt;
    if (perLesson[s.lessonId]) { perLesson[s.lessonId].minutes += min; perLesson[s.lessonId].sessions += 1; }
  }
  let lessonsDoneTotal = 0;
  for (const done of Object.values(progress)) {
    for (const id of Object.keys(done)) { lessonsDoneTotal += 1; if (perLesson[id]) perLesson[id].completions += 1; }
  }
  const minutesTotal = sessions.reduce((a, s) => a + s.seconds / 60, 0);
  const minutesToday = sessions.filter((s) => dayKey(s.startedAt) === today).reduce((a, s) => a + s.seconds / 60, 0);
  const paid = orders.filter((o) => o.status === "PAID");
  const monthStart = today.slice(0, 7);

  res.json({
    totals: {
      users: users.length,
      usersToday: users.filter((u) => dayKey(u.createdAt) === today).length,
      usersLast7d: users.filter((u) => (u.createdAt ?? "") >= weekAgo).length,
      activeLast7d: Object.values(lastSeenByEmail).filter((d) => d >= weekAgo).length,
      subscribers: users.filter((u) => !entitlement(u).free).length,
      sessionsTotal: sessions.length,
      sessionsToday: sessions.filter((s) => dayKey(s.startedAt) === today).length,
      minutesTotal: Math.round(minutesTotal),
      minutesToday: Math.round(minutesToday),
      lessonsDoneTotal,
      estimatedCostBrl: Number((minutesTotal * COST_PER_MINUTE_BRL).toFixed(2)),
      revenueTotalCents: paid.reduce((a, o) => a + o.amountCents, 0),
      revenueMonthCents: paid.filter((o) => dayKey(o.paidAt).startsWith(monthStart)).reduce((a, o) => a + o.amountCents, 0),
    },
    users: users
      .map((u) => ({
        name: u.name ?? "",
        email: u.email,
        createdAt: u.createdAt ?? null,
        profile: u.profile ?? {},
        role: u.role ?? "user",
        blocked: Boolean(u.blocked),
        plan: u.plan ?? null,
        entitlement: entitlement(u),
        lessonsDone: Object.keys(progress[u.email] ?? {}).length,
        minutes: Math.round(minutesByEmail[u.email] ?? 0),
        lastSeen: lastSeenByEmail[u.email] ?? null,
      }))
      .sort((a, b) => (b.lastSeen ?? b.createdAt ?? "").localeCompare(a.lastSeen ?? a.createdAt ?? "")),
    lessons: Object.values(perLesson).map((l) => ({ ...l, minutes: Math.round(l.minutes) })),
    plans: getPlans(),
    orders: orders.slice(-100).reverse(),
    recentSessions: sessions.slice(-40).reverse(),
    pix: { configured: pagbank.configured, environment: pagbank.environment, webhook: Boolean((process.env.PUBLIC_URL ?? "").startsWith("https://")) },
  });
});

// ---------- usuarios ----------

router.put("/users/:email", (req, res) => {
  const email = req.params.email;
  const user = findUserByEmail(email);
  if (!user) return res.status(404).json({ error: "usuario nao encontrado" });
  const { name, role, blocked, profile, plan } = req.body ?? {};
  const patch = {};
  if (typeof name === "string") patch.name = name.trim().slice(0, 80);
  if (role === "admin" || role === "user") patch.role = role;
  if (typeof blocked === "boolean") patch.blocked = blocked;
  if (profile && typeof profile === "object") {
    patch.profile = { ...(user.profile ?? {}) };
    for (const key of PROFILE_KEYS) {
      if (profile[key] === "" || profile[key] === null) delete patch.profile[key];
      else if (typeof profile[key] === "string" && profile[key].length <= 40) patch.profile[key] = profile[key];
    }
  }
  if (plan !== undefined) {
    if (!plan || !plan.planId) patch.plan = null;
    else {
      const p = getPlans().find((x) => x.id === plan.planId);
      if (!p) return res.status(400).json({ error: "plano invalido" });
      const expiresAt = plan.expiresAt ? new Date(plan.expiresAt) : new Date(Date.now() + p.days * 86400000);
      if (Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: "data de expiracao invalida" });
      patch.plan = { id: p.id, name: p.name, minutesPerDay: p.minutesPerDay, activatedAt: user.plan?.activatedAt ?? new Date().toISOString(), expiresAt: expiresAt.toISOString(), grantedByAdmin: true };
    }
  }
  const updated = updateUser(email, patch);
  const { passwordHash, ...safe } = updated;
  res.json({ ...safe, entitlement: entitlement(updated) });
});

router.post("/users/:email/password", async (req, res) => {
  const { password } = req.body ?? {};
  if (!password || password.length < 6) return res.status(400).json({ error: "senha com no minimo 6 caracteres" });
  if (!findUserByEmail(req.params.email)) return res.status(404).json({ error: "usuario nao encontrado" });
  updateUser(req.params.email, { passwordHash: await bcrypt.hash(password, 10) });
  res.json({ ok: true });
});

router.delete("/users/:email", (req, res) => {
  if (!findUserByEmail(req.params.email)) return res.status(404).json({ error: "usuario nao encontrado" });
  deleteUser(req.params.email);
  res.json({ ok: true });
});

// ---------- planos ----------

function cleanPlan(input, existing = {}) {
  const plan = { ...existing };
  if (typeof input.name === "string" && input.name.trim()) plan.name = input.name.trim().slice(0, 60);
  if (typeof input.description === "string") plan.description = input.description.trim().slice(0, 160);
  if (Number.isFinite(Number(input.minutesPerDay)) && Number(input.minutesPerDay) > 0) plan.minutesPerDay = Math.round(Number(input.minutesPerDay));
  if (Number.isFinite(Number(input.priceCents)) && Number(input.priceCents) >= 0) plan.priceCents = Math.round(Number(input.priceCents));
  if (Number.isFinite(Number(input.days)) && Number(input.days) > 0) plan.days = Math.round(Number(input.days));
  if (typeof input.active === "boolean") plan.active = input.active;
  return plan;
}

router.post("/plans", (req, res) => {
  const plans = getPlans();
  const plan = cleanPlan(req.body ?? {}, { id: "", name: "", description: "", minutesPerDay: 5, priceCents: 2990, days: 30, active: true });
  plan.id = String(req.body?.id || plan.name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  if (!plan.id || !plan.name) return res.status(400).json({ error: "nome obrigatorio" });
  if (plans.some((p) => p.id === plan.id)) return res.status(409).json({ error: "ja existe um plano com esse id" });
  plans.push(plan);
  savePlans(plans);
  res.json(plan);
});

router.put("/plans/:id", (req, res) => {
  const plans = getPlans();
  const i = plans.findIndex((p) => p.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "plano nao encontrado" });
  plans[i] = cleanPlan(req.body ?? {}, plans[i]);
  savePlans(plans);
  res.json(plans[i]);
});

router.delete("/plans/:id", (req, res) => {
  const plans = getPlans();
  if (!plans.some((p) => p.id === req.params.id)) return res.status(404).json({ error: "plano nao encontrado" });
  savePlans(plans.filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

// ---------- licoes ----------

router.get("/lessons/:id", (req, res) => {
  try { res.json(getLesson(req.params.id)); } catch { res.status(404).json({ error: "licao nao encontrada" }); }
});

router.post("/lessons/generate", async (req, res) => {
  try {
    const lesson = await generateLesson({ level: req.body?.level, theme: req.body?.theme });
    res.json(lesson);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const LESSON_KEYS = ["id", "title", "level", "focus", "warmup", "freeConversation", "review", "active"];

router.post("/lessons", (req, res) => {
  const input = req.body ?? {};
  if (!input.title || !input.level || !input.warmup?.examples?.length || !input.freeConversation?.instruction || !input.review?.checklist?.length) {
    return res.status(400).json({ error: "licao incompleta" });
  }
  const lesson = Object.fromEntries(Object.entries(input).filter(([k]) => LESSON_KEYS.includes(k)));
  if (lesson.id && listLessons(true).some((l) => l.id === lesson.id)) {
    // edicao de uma licao existente: mantem o id
  } else {
    delete lesson.id;
  }
  try { res.json(saveLesson(lesson)); } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put("/lessons/:id", (req, res) => {
  try {
    const lesson = getLesson(req.params.id);
    if (typeof req.body?.active === "boolean") lesson.active = req.body.active;
    res.json(saveLesson(lesson));
  } catch { res.status(404).json({ error: "licao nao encontrada" }); }
});

router.delete("/lessons/:id", (req, res) => {
  try { deleteLesson(req.params.id); res.json({ ok: true }); } catch { res.status(404).json({ error: "licao nao encontrada" }); }
});
