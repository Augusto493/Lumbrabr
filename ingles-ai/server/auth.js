import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { findUserByEmail, saveUser } from "./store.js";

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = "30d";

export const router = express.Router();

router.post("/register", async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "email e senha (min. 6 caracteres) sao obrigatorios" });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: "ja existe uma conta com esse email" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  saveUser({ email, name: name ?? "", passwordHash, createdAt: new Date().toISOString() });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, email, name: name ?? "" });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = findUserByEmail(email ?? "");
  if (!user) return res.status(401).json({ error: "email ou senha invalidos" });
  const ok = await bcrypt.compare(password ?? "", user.passwordHash);
  if (!ok) return res.status(401).json({ error: "email ou senha invalidos" });
  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, email: user.email, name: user.name ?? "" });
});

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "token ausente" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "token invalido ou expirado" });
  }
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
