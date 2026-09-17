import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { getUsers, getProgress, getSessions } from "./store.js";
import { listLessons } from "./lessons.js";

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COST_PER_MINUTE_BRL = 0.07;

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

function dayKey(iso) {
  return iso.slice(0, 10);
}

router.get("/stats", requireAdmin, (_req, res) => {
  const users = Object.values(getUsers());
  const progress = getProgress();
  const sessions = getSessions();
  const lessons = listLessons();

  const today = dayKey(new Date().toISOString());
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const minutesByEmail = {};
  const lastSeenByEmail = {};
  const perLesson = Object.fromEntries(lessons.map((l) => [l.id, { id: l.id, title: l.title, level: l.level, completions: 0, minutes: 0, sessions: 0 }]));

  for (const s of sessions) {
    const min = s.seconds / 60;
    minutesByEmail[s.email] = (minutesByEmail[s.email] ?? 0) + min;
    if (!lastSeenByEmail[s.email] || s.startedAt > lastSeenByEmail[s.email]) lastSeenByEmail[s.email] = s.startedAt;
    if (perLesson[s.lessonId]) { perLesson[s.lessonId].minutes += min; perLesson[s.lessonId].sessions += 1; }
  }
  let lessonsDoneTotal = 0;
  for (const [email, done] of Object.entries(progress)) {
    for (const id of Object.keys(done)) { lessonsDoneTotal += 1; if (perLesson[id]) perLesson[id].completions += 1; }
    void email;
  }

  const minutesTotal = sessions.reduce((a, s) => a + s.seconds / 60, 0);
  const minutesToday = sessions.filter((s) => dayKey(s.startedAt) === today).reduce((a, s) => a + s.seconds / 60, 0);

  res.json({
    totals: {
      users: users.length,
      usersToday: users.filter((u) => dayKey(u.createdAt ?? "") === today).length,
      usersLast7d: users.filter((u) => (u.createdAt ?? "") >= weekAgo).length,
      activeLast7d: Object.values(lastSeenByEmail).filter((d) => d >= weekAgo).length,
      sessionsTotal: sessions.length,
      sessionsToday: sessions.filter((s) => dayKey(s.startedAt) === today).length,
      minutesTotal: Math.round(minutesTotal),
      minutesToday: Math.round(minutesToday),
      lessonsDoneTotal,
      estimatedCostBrl: Number((minutesTotal * COST_PER_MINUTE_BRL).toFixed(2)),
    },
    users: users
      .map((u) => ({
        name: u.name ?? "",
        email: u.email,
        createdAt: u.createdAt ?? null,
        profile: u.profile ?? {},
        lessonsDone: Object.keys(progress[u.email] ?? {}).length,
        minutes: Math.round(minutesByEmail[u.email] ?? 0),
        lastSeen: lastSeenByEmail[u.email] ?? null,
      }))
      .sort((a, b) => (b.lastSeen ?? b.createdAt ?? "").localeCompare(a.lastSeen ?? a.createdAt ?? "")),
    lessons: Object.values(perLesson).map((l) => ({ ...l, minutes: Math.round(l.minutes) })),
    recentSessions: sessions.slice(-40).reverse(),
  });
});
