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
    default: "gemini-3.5-flash,gemini-3.7-flash,gemini-3.5-flash-lite",
    help: "Se o modelo de texto principal estiver sobrecarregado (503) ou não existir mais (404), tenta estes na ordem.",
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
    key: "MAX_CONCURRENT_VOICE", group: "limites", label: "Conversas simultâneas (máximo)", type: "number", min: 1,
    default: "20",
    help: "Acima disso a Mel avisa que está ocupada e pede pra tentar em 1 minuto, em vez de estourar o limite da API do Gemini. No tier grátis do Gemini deixe baixo (3); com faturamento ativado pode subir.",
  },
  {
    key: "LAUNCH_PROMO_ENABLED", group: "lancamento", label: "Promoção de lançamento ligada", type: "select", options: ["sim", "nao"],
    default: "sim",
    help: "Enquanto ligada e houver vaga, quem cria conta ganha o plano de lançamento automaticamente.",
  },
  {
    key: "LAUNCH_PROMO_SLOTS", group: "lancamento", label: "Vagas (primeiros N cadastros)", type: "number", min: 0,
    default: "100",
    help: "Quantas contas ganham a promoção. O app mostra 'restam X vagas' na tela inicial.",
  },
  {
    key: "LAUNCH_PROMO_MINUTES", group: "lancamento", label: "Minutos por dia da promoção", type: "number", min: 1,
    default: "3",
  },
  {
    key: "LAUNCH_PROMO_DAYS", group: "lancamento", label: "Duração da promoção (dias)", type: "number", min: 1,
    default: "30",
  },
  {
    key: "LAUNCH_PROMO_NAME", group: "lancamento", label: "Nome do plano de lançamento",
    default: "Lançamento",
    help: "Aparece no chip do plano na home do aluno.",
  },
  {
    key: "REF_REWARD_MINUTES", group: "viral", label: "Bônus pra quem indica (minutos)", type: "number", min: 0,
    default: "10",
    help: "Creditado quando o amigo indicado faz a primeira aula (não no cadastro, pra não valer conta fake).",
  },
  {
    key: "REF_WELCOME_MINUTES", group: "viral", label: "Bônus pra quem foi indicado (minutos)", type: "number", min: 0,
    default: "5",
    help: "Creditado no cadastro de quem entrou por link de indicação.",
  },
  {
    key: "MISSION_STORY_MINUTES", group: "viral", label: "Missão story (minutos)", type: "number", min: 0,
    default: "15",
    help: "Prêmio por story marcando o perfil, com print aprovado no painel. Uma vez a cada 7 dias por aluno.",
  },
  {
    key: "MISSION_POST_MINUTES", group: "viral", label: "Missão post/vídeo (minutos)", type: "number", min: 0,
    default: "30",
    help: "Prêmio por post ou vídeo público sobre a Mel, com print aprovado. Uma vez a cada 30 dias por aluno.",
  },
  {
    key: "SOCIAL_HANDLE", group: "viral", label: "Perfil pra marcar (Instagram/TikTok)",
    default: "@heymel.online",
    help: "Aparece nas missões: 'poste e marque @...'.",
  },
  {
    key: "ABACATEPAY_API_KEY", group: "pagamento", label: "Chave da API da AbacatePay", secret: true,
    help: "Crie em abacatepay.com → Integração → Chaves de API. Chave criada em Dev mode gera Pix simulado (dá pra 'pagar' com um botão no app); chave de produção cobra de verdade.",
  },
  {
    key: "ABACATEPAY_WEBHOOK_SECRET", group: "pagamento", label: "Segredo do webhook da AbacatePay", secret: true,
    help: "Em abacatepay.com → Integração → Webhooks, cadastre a URL <PUBLIC_URL>/api/pay/webhook com o evento transparent.completed e um segredo; cole o mesmo segredo aqui. Sem webhook o app confere o pagamento por consulta a cada 4 s (funciona, só não é instantâneo).",
  },
  {
    key: "PUBLIC_URL", group: "pagamento", label: "URL pública do app (https)", type: "url",
    default: "https://heymel.online",
    help: "Usada nos links de indicação e pra a AbacatePay confirmar o pagamento por webhook.",
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
