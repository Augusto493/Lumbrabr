import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = {
  users: path.join(DATA_DIR, "users.json"),
  progress: path.join(DATA_DIR, "progress.json"),
  sessions: path.join(DATA_DIR, "sessions.json"),
  plans: path.join(DATA_DIR, "plans.json"),
  orders: path.join(DATA_DIR, "orders.json"),
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
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
