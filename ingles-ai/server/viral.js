import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "./auth.js";
import { findUserByEmail, updateUser, getUsers, getMissions, saveMission, addBonusMinutes, newRefCode, UPLOADS_DIR } from "./store.js";
import * as settings from "./settings.js";

// Motor viral: link de indicacao (quem indica ganha quando o amigo faz a
// primeira aula; o amigo ganha no cadastro) e missoes "poste e ganhe"
// (o aluno manda um print do story/post, o admin aprova no painel e os
// minutos bonus caem na conta).

export const MISSIONS = {
  story: { key: "MISSION_STORY_MINUTES", label: "Story marcando a Mel", days: 7, how: "Posta um story usando a Mel (print da tela ou vídeo) e marca o perfil. Manda o print aqui." },
  post: { key: "MISSION_POST_MINUTES", label: "Post ou vídeo sobre a Mel", days: 30, how: "Post no feed, Reels ou TikTok contando como foi levar bronca da Mel. Marca o perfil e manda o print (ou o link)." },
};

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function publicUrl() {
  return String(settings.get("PUBLIC_URL") ?? "").replace(/\/$/, "") || "https://heymel.online";
}

export function referralLink(user) {
  return `${publicUrl()}/?ref=${user.refCode}`;
}

export function missionReward(type) {
  return settings.getNumber(MISSIONS[type]?.key ?? "", 0);
}

// chamado quando um aluno conclui a primeira aula: credita quem o indicou
export function creditReferralForFirstLesson(email) {
  const user = findUserByEmail(email);
  if (!user?.referredBy || user.referralCredited) return;
  const reward = settings.getNumber("REF_REWARD_MINUTES", 0);
  updateUser(email, { referralCredited: true, referralCreditedAt: new Date().toISOString() });
  if (reward > 0) addBonusMinutes(user.referredBy, reward, `indicação: ${user.name || user.email}`);
}

export function referralsOf(email) {
  return Object.values(getUsers())
    .filter((u) => u.referredBy === email)
    .map((u) => ({ name: (u.name || u.email.split("@")[0]).split(" ")[0], createdAt: u.createdAt, credited: Boolean(u.referralCredited) }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export const router = express.Router();
router.use(requireAuth);

router.get("/me", (req, res) => {
  let user = findUserByEmail(req.user.email);
  if (!user) return res.status(404).json({ error: "conta nao encontrada" });
  // contas criadas antes do programa de indicacao ganham codigo na primeira visita
  if (!user.refCode) user = updateUser(user.email, { refCode: newRefCode() });
  const referrals = referralsOf(user.email);
  const missions = getMissions().filter((m) => m.email === user.email).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({
    refCode: user.refCode,
    link: referralLink(user),
    social: settings.get("SOCIAL_HANDLE") || "@heymel.online",
    rewards: { referrer: settings.getNumber("REF_REWARD_MINUTES", 0), welcome: settings.getNumber("REF_WELCOME_MINUTES", 0), story: missionReward("story"), post: missionReward("post") },
    bonusMinutes: user.bonusMinutes ?? 0,
    minutesEarned: (user.bonusLog ?? []).filter((b) => b.minutes > 0).reduce((a, b) => a + b.minutes, 0),
    referrals,
    missions: missions.map(({ id, type, status, createdAt, reviewedAt, reward, note }) => ({ id, type, status, createdAt, reviewedAt, reward, note: note ?? null })),
    rules: Object.fromEntries(Object.entries(MISSIONS).map(([k, v]) => [k, { label: v.label, days: v.days, how: v.how }])),
  });
});

router.post("/missions", (req, res) => {
  const { type, image, link } = req.body ?? {};
  const rule = MISSIONS[type];
  if (!rule) return res.status(400).json({ error: "missao invalida" });
  const user = findUserByEmail(req.user.email);
  if (!user) return res.status(404).json({ error: "conta nao encontrada" });

  const mine = getMissions().filter((m) => m.email === user.email && m.type === type);
  if (mine.some((m) => m.status === "pending")) return res.status(409).json({ error: "você já tem um print dessa missão esperando aprovação" });
  const lastApproved = mine.filter((m) => m.status === "approved").map((m) => m.reviewedAt).sort().pop();
  if (lastApproved && Date.now() - new Date(lastApproved).getTime() < rule.days * 86400000) {
    const next = new Date(new Date(lastApproved).getTime() + rule.days * 86400000);
    return res.status(429).json({ error: `essa missão libera de novo em ${next.toLocaleDateString("pt-BR")}` });
  }

  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(image ?? ""));
  if (!match) return res.status(400).json({ error: "manda uma imagem (print) em PNG, JPG ou WebP" });
  const buf = Buffer.from(match[2], "base64");
  if (buf.length < 2000 || buf.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: "imagem muito grande (máx. 3 MB) ou inválida" });
  const ext = match[1] === "jpg" ? "jpeg" : match[1];
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, `${id}.${ext}`), buf);

  const mission = saveMission({
    id, email: user.email, type, image: `${id}.${ext}`, link: String(link ?? "").trim().slice(0, 300) || null,
    status: "pending", reward: missionReward(type), createdAt: new Date().toISOString(), reviewedAt: null, note: null,
  });
  res.json({ id: mission.id, status: mission.status, reward: mission.reward });
});
