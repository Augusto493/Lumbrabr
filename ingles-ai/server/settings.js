import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "..", "data", "settings.json");

// Cada configuracao pode vir do painel (data/settings.json, tem prioridade)
// ou do .env (usado como valor inicial/reserva). GEMINI_API_KEY e JWT_SECRET
// precisam existir no .env no primeiro boot -- depois disso podem ser
// trocadas pelo painel sem reiniciar o servidor.
export const DEFINITIONS = [
  {
    key: "GEMINI_API_KEY", group: "ia", label: "Chave da API do Gemini", secret: true,
    help: "Gerada em aistudio.google.com/apikey. Precisa existir no .env na primeira vez que o servidor sobe.",
  },
  {
    key: "GEMINI_LIVE_MODEL", group: "ia", label: "Modelo de voz (conversa)",
    default: "gemini-2.5-flash-native-audio-preview-12-2025",
    help: "Usado na conversa por voz com a Mel (Live API). O nome muda com frequencia -- confira em ai.google.dev/gemini-api/docs/live-api.",
  },
  {
    key: "GEMINI_TEXT_MODEL", group: "ia", label: "Modelo de texto (gerar lições)",
    default: "gemini-3.6-flash",
    help: "Usado pra escrever lições novas na aba Lições.",
  },
  {
    key: "GEMINI_TEXT_FALLBACKS", group: "ia", label: "Modelos reserva (separados por vírgula)",
    default: "gemini-3.5-flash,gemini-3.6-flash-lite",
    help: "Se o modelo de texto principal estiver sobrecarregado (503), tenta estes na ordem.",
  },
  {
    key: "ADMIN_EMAIL", group: "acesso", label: "E-mails com acesso de admin",
    help: "Contas com estes e-mails ganham o botão \"painel\" no app e entram aqui sem senha extra. Separe vários por vírgula.",
  },
  {
    key: "ADMIN_PASSWORD", group: "acesso", label: "Senha única do painel", secret: true,
    help: "Porta de entrada alternativa pra abrir /admin sem precisar de uma conta de usuário.",
  },
  {
    key: "FREE_MINUTES_PER_DAY", group: "limites", label: "Minutos grátis por dia", type: "number", min: 0,
    default: "3",
    help: "Quanto quem não assinou pode conversar com a Mel por dia antes de ver o paywall.",
  },
  {
    key: "PAGBANK_TOKEN", group: "pagamento", label: "Token do PagBank", secret: true,
    help: "Crie em PagBank → Vender online → Integrações. Use o token de sandbox pra testar antes de ir pra produção.",
  },
  {
    key: "PAGBANK_ENV", group: "pagamento", label: "Ambiente do PagBank", type: "select", options: ["sandbox", "production"],
    default: "sandbox",
    help: "Sandbox = dinheiro de mentira, pra testar. Production = Pix de verdade.",
  },
  {
    key: "PUBLIC_URL", group: "pagamento", label: "URL pública do app (https)", type: "url",
    help: "Necessária pra o PagBank confirmar o pagamento por webhook. Sem ela, o app confere o status por consulta (funciona, só que não é instantâneo).",
  },
  {
    key: "JWT_SECRET", group: "seguranca", label: "Segredo de sessão (JWT)", secret: true,
    help: "Precisa existir no .env na primeira vez que o servidor sobe. Trocar aqui desloga todo mundo, você incluso -- o painel te dá um token novo automaticamente.",
  },
];

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
}

export function get(key) {
  const stored = load()[key];
  if (stored !== undefined && stored !== "") return stored;
  if (process.env[key]) return process.env[key];
  const def = DEFINITIONS.find((d) => d.key === key);
  return def?.default ?? "";
}

export function getNumber(key, fallback = 0) {
  const n = Number(get(key));
  return Number.isFinite(n) ? n : fallback;
}

export function has(key) {
  return Boolean(get(key));
}

export function set(key, value) {
  load();
  cache[key] = value;
  persist();
}

export function allForAdmin() {
  return DEFINITIONS.map((def) => {
    const value = get(def.key);
    if (def.secret) {
      return { ...def, hasValue: Boolean(value), hint: value ? `termina em ${String(value).slice(-4)}` : null };
    }
    return { ...def, value };
  });
}
