import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const FILE = {
  users: path.join(DATA_DIR, "users.json"),
  progress: path.join(DATA_DIR, "progress.json"),
  sessions: path.join(DATA_DIR, "sessions.json"),
  plans: path.join(DATA_DIR, "plans.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  missions: path.join(DATA_DIR, "missions.json"),
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

// escrita atomica: grava num temporario e renomeia, pra uma queda no meio
// da escrita nunca deixar o arquivo pela metade
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Armazenamento simples em arquivo: suficiente para o volume de um MVP
// (poucos usuarios simultaneos). Escreve o arquivo inteiro a cada mudanca,
// entao nao serve para alta concorrencia -- trocar por um banco real
// quando o produto validar.

// ---------- usuarios ----------

export function getUsers() {
  return readJson(FILE.users, {});
}

export function saveUser(user) {
  const users = getUsers();
  users[user.email] = user;
  writeJson(FILE.users, users);
}

export function findUserByEmail(email) {
  return getUsers()[email] ?? null;
}

export function updateUser(email, patch) {
  const users = getUsers();
  if (!users[email]) return null;
  users[email] = { ...users[email], ...patch };
  writeJson(FILE.users, users);
  return users[email];
}

export function findUserByRefCode(code) {
  const wanted = String(code ?? "").trim().toUpperCase();
  if (!wanted) return null;
  return Object.values(getUsers()).find((u) => u.refCode === wanted) ?? null;
}

// codigo de indicacao curto e legivel (sem 0/O, 1/I)
export function newRefCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const users = getUsers();
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!Object.values(users).some((u) => u.refCode === code)) return code;
  }
}

// saldo de minutos bonus (indicacoes e missoes): soma ou desconta, nunca fica negativo
export function addBonusMinutes(email, minutes, reason) {
  const users = getUsers();
  const u = users[email];
  if (!u) return null;
  u.bonusMinutes = Math.max(0, Math.round(((u.bonusMinutes ?? 0) + minutes) * 10) / 10);
  u.bonusLog = [...(u.bonusLog ?? []).slice(-49), { at: new Date().toISOString(), minutes, reason }];
  writeJson(FILE.users, users);
  return u.bonusMinutes;
}

export function countPromoUsers() {
  return Object.values(getUsers()).filter((u) => u.promo).length;
}

export function deleteUser(email) {
  const users = getUsers();
  delete users[email];
  writeJson(FILE.users, users);
  const progress = getProgress();
  delete progress[email];
  writeJson(FILE.progress, progress);
}

// ---------- progresso ----------

export function getProgress() {
  return readJson(FILE.progress, {});
}

export function markLessonDone(email, lessonId) {
  const progress = getProgress();
  progress[email] = progress[email] ?? {};
  progress[email][lessonId] = { completedAt: new Date().toISOString() };
  writeJson(FILE.progress, progress);
}

export function getUserProgress(email) {
  return getProgress()[email] ?? {};
}

// ---------- sessoes de voz ----------

export function logSession(entry) {
  const sessions = readJson(FILE.sessions, []);
  sessions.push(entry);
  writeJson(FILE.sessions, sessions);
}

export function getSessions() {
  return readJson(FILE.sessions, []);
}

export function minutesUsedToday(email) {
  const today = new Date().toISOString().slice(0, 10);
  return getSessions()
    .filter((s) => s.email === email && s.startedAt.slice(0, 10) === today)
    .reduce((sum, s) => sum + s.seconds / 60, 0);
}

// ---------- missoes (poste e ganhe) ----------

export function getMissions() {
  return readJson(FILE.missions, []);
}

export function saveMission(mission) {
  const missions = getMissions();
  const i = missions.findIndex((m) => m.id === mission.id);
  if (i >= 0) missions[i] = mission;
  else missions.push(mission);
  writeJson(FILE.missions, missions);
  return mission;
}

// ---------- planos ----------

const DEFAULT_PLANS = [
  { id: "5min", name: "5 min por dia", description: "Uma conversa curta por dia. O suficiente pra destravar.", minutesPerDay: 5, priceCents: 2990, days: 30, active: true },
  { id: "10min", name: "10 min por dia", description: "O ritmo que a maioria consegue manter.", minutesPerDay: 10, priceCents: 4990, days: 30, active: true },
  { id: "20min", name: "20 min por dia", description: "Ritmo puxado. Dá — mas a Mel cobra.", minutesPerDay: 20, priceCents: 7990, days: 30, active: true },
];

export function getPlans() {
  const plans = readJson(FILE.plans, null);
  if (!plans) {
    writeJson(FILE.plans, DEFAULT_PLANS);
    return DEFAULT_PLANS;
  }
  return plans;
}

export function savePlans(plans) {
  writeJson(FILE.plans, plans);
}

// ---------- pedidos (pix) ----------

export function getOrders() {
  return readJson(FILE.orders, []);
}

export function findOrder(id) {
  return getOrders().find((o) => o.id === id) ?? null;
}

export function saveOrder(order) {
  const orders = getOrders();
  const i = orders.findIndex((o) => o.id === order.id);
  if (i >= 0) orders[i] = order;
  else orders.push(order);
  writeJson(FILE.orders, orders);
  return order;
}
