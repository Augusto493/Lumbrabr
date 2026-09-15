import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PROGRESS_FILE = path.join(DATA_DIR, "progress.json");

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
export function getUsers() {
  return readJson(USERS_FILE, {});
}

export function saveUser(user) {
  const users = getUsers();
  users[user.email] = user;
  writeJson(USERS_FILE, users);
}

export function findUserByEmail(email) {
  return getUsers()[email] ?? null;
}

export function getProgress() {
  return readJson(PROGRESS_FILE, {});
}

export function markLessonDone(email, lessonId) {
  const progress = getProgress();
  progress[email] = progress[email] ?? {};
  progress[email][lessonId] = { completedAt: new Date().toISOString() };
  writeJson(PROGRESS_FILE, progress);
}

export function getUserProgress(email) {
  return getProgress()[email] ?? {};
}
