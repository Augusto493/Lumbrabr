import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { findUserByEmail, saveUser } from "./store.js";
import * as settings from "./settings.js";

const TOKEN_TTL = "30d";

export const router = express.Router();

const PROFILE_KEYS = ["voiceMode", "level", "blocker", "tone"];

// le sempre o valor atual (nao trava no boot) pra editar pelo painel funcionar sem reiniciar
export function jwtSecret() {
  return settings.get("JWT_SECRET");
}

export function isAdminEmail(email) {
  const list = (settings.get("ADMIN_EMAIL") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email ?? "").toLowerCase());
}

export function roleOf(email, user = null) {
  return isAdminEmail(email) || user?.role === "admin" ? "admin" : "user";
}

function cleanProfile(input) {
  const profile = {};
  if (!input || typeof input !== "object") return profile;
  for (const key of PROFILE_KEYS) {
    if (typeof input[key] === "string" && input[key].length <= 40) profile[key] = input[key];
  }
  return profile;
}

router.post("/register", async (req, res) => {
  const { email, password, name, profile } = req.body ?? {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "email e senha (min. 6 caracteres) sao obrigatorios" });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: "ja existe uma conta com esse email" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const cleaned = cleanProfile(profile);
  saveUser({ email, name: name ?? "", passwordHash, profile: cleaned, createdAt: new Date().toISOString() });
  const role = roleOf(email);
  const token = jwt.sign({ email, role }, jwtSecret(), { expiresIn: TOKEN_TTL });
  res.json({ token, email, name: name ?? "", profile: cleaned, role });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = findUserByEmail(email ?? "");
  if (!user) return res.status(401).json({ error: "email ou senha invalidos" });
  const ok = await bcrypt.compare(password ?? "", user.passwordHash);
  if (!ok) return res.status(401).json({ error: "email ou senha invalidos" });
  if (user.blocked) return res.status(403).json({ error: "essa conta esta bloqueada" });
  const role = roleOf(user.email, user);
  const token = jwt.sign({ email: user.email, role }, jwtSecret(), { expiresIn: TOKEN_TTL });
  res.json({ token, email: user.email, name: user.name ?? "", profile: user.profile ?? {}, role });
});

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "token ausente" });
  try {
    req.user = jwt.verify(token, jwtSecret());
    next();
  } catch {
    res.status(401).json({ error: "token invalido ou expirado" });
  }
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}
