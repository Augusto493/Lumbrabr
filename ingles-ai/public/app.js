const app = document.getElementById("app");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  del(key) { try { localStorage.removeItem(key); } catch {} },
};

const state = {
  token: store.get("token", null),
  name: store.get("name", ""),
  onboarding: store.get("onboarding", {}),
  lessons: [],
  currentLesson: null,
  ws: null,
  audioCtx: null,
  micStream: null,
  processorNode: null,
  playbackCtx: null,
  nextPlaybackTime: 0,
  recording: false,
  moodTimer: null,
  timer: null,
  startedAt: 0,
  turn: null,
  studentLine: null,
};

// ---------- conteudo do onboarding ----------

const SLIDES = [
  { orbit: "icons", mood: "grumpy", h: "Oi. Eu sou a Mel.", p: "A professora de inglês que não tem paciência nenhuma — mas que faz você falar." },
  { orbit: "flags", mood: "neutral", h: "3 minutos por dia de conversa. Sem enrolação.", p: "" },
  { orbit: "glow", mood: "happy", tag: "🇧🇷 BRASIL", h: "Sua professora de IA particular.", p: "Disponível a qualquer hora, em qualquer lugar. Mal-humorada em todos eles." },
];

const QUESTIONS = [
  {
    id: "voiceMode",
    q: "Antes de começar: como você prefere me ouvir?",
    hint: "Você pode mudar isso depois.",
    opts: [
      { v: "sempre", icon: "speaker-high", t: "Pode falar normalmente" },
      { v: "exercicios", icon: "speaker-low", t: "Só nos exercícios de fala" },
    ],
  },
  {
    id: "level",
    eyebrow: (a) => (a.voiceMode === "exercicios" ? "voz só nos exercícios" : "voz em tudo"),
    q: "Quanto você entende de inglês?",
    opts: [
      { v: "zero", bars: 0, t: "Não sei nada de inglês" },
      { v: "basico", bars: 1, t: "Conheço algumas palavras comuns" },
      { v: "simples", bars: 2, t: "Consigo ter conversas simples" },
      { v: "variado", bars: 3, t: "Consigo falar de assuntos variados" },
      { v: "fluente", bars: 4, t: "Falo sobre a maioria dos assuntos em detalhes" },
    ],
  },
  {
    id: "blocker",
    q: "E o que mais te trava na hora de falar?",
    hint: "Sem julgamento. Ok, um pouco.",
    opts: [
      { v: "vergonha", icon: "mask-sad", t: "Vergonha de errar" },
      { v: "congelo", icon: "snowflake", t: "Eu congelo e esqueço tudo" },
      { v: "nao_sei", icon: "compass", t: "Não sei por onde começar" },
      { v: "falta_gente", icon: "users", t: "Não tenho com quem praticar" },
    ],
  },
  {
    id: "tone",
    q: "Última: como você quer que eu fale com você?",
    hint: "Dá pra mudar depois. Mas você não vai.",
    opts: [
      { v: "braba", mascot: "grumpy", t: "Braba", d: "Cobra, fica puta e fala palavrão. Pega no seu pé até você falar." },
      { v: "deboa", mascot: "happy", t: "De boa", d: "Sem xingar. Espera você tentar de novo, quantas vezes precisar." },
    ],
  },
];

const WEEKS_BY_LEVEL = { zero: 16, basico: 12, simples: 8, variado: 5, fluente: 3 };
const GOAL_BY_BLOCKER = {
  vergonha: "fala sem aquele medo de errar",
  congelo: "responde sem travar",
  nao_sei: "sabe exatamente o que praticar",
  falta_gente: "tem com quem conversar todo dia",
};

const GREETINGS = [
  "Voltou. Que milagre. Escolhe uma lição aí.",
  "Ah, é você de novo. Bora, não tenho o dia todo.",
  "Chegou atrasado pra própria aula. Clássico. Escolhe uma.",
  "Tá esperando o quê? Convite formal? Clica numa lição.",
];

// ---------- infra de render ----------

function render(html) {
  stopVoiceSession();
  app.innerHTML = html;
  $$("[data-mascot]").forEach((el) => Mascot.build(el, { size: Number(el.dataset.mascot), mood: el.dataset.mood || "grumpy" }));
  window.scrollTo(0, 0);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(raw) {
  return esc(raw).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*/g, "");
}

function authHeaders() {
  return { Authorization: `Bearer ${state.token}` };
}

function logout() {
  store.del("token");
  store.del("name");
  state.token = null;
  state.name = "";
  goAuth("login");
}

function projection() {
  const a = state.onboarding;
  const weeks = WEEKS_BY_LEVEL[a.level] ?? 8;
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  const dateLabel = date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" }).toUpperCase();
  return { weeks, dateLabel, goal: GOAL_BY_BLOCKER[a.blocker] ?? "conversa sem travar" };
}

// ---------- intro (3 slides) ----------

const ORBIT_ICONS = [
  ["chats-circle", 26, "12%", "18%"], ["star-four", 14, "50%", "4%"], ["airplane-tilt", 26, "76%", "12%"],
  ["briefcase", 24, "3%", "50%"], ["fork-knife", 24, "88%", "47%"], ["coffee", 24, "12%", "80%"],
  ["guitar", 24, "74%", "78%"], ["star-four", 14, "26%", "92%"],
];
const ORBIT_FLAGS = [
  ["🇺🇸", "6%", "16%"], ["🇩🇪", "56%", "2%"], ["🇧🇷", "78%", "12%"], ["🇫🇷", "2%", "54%"],
  ["🇪🇸", "86%", "50%"], ["🇯🇵", "12%", "82%"], ["🇬🇧", "27%", "94%"], ["🇮🇹", "72%", "82%"],
];

function orbitHtml(kind, mood) {
  let extras = "";
  if (kind === "icons") {
    extras = ORBIT_ICONS.map(([name, size, left, top]) => `<span class="fl" style="left:${left};top:${top}">${icon(name, size)}</span>`).join("");
  } else if (kind === "flags") {
    extras = ORBIT_FLAGS.map(([flag, left, top]) => `<span class="fl" style="left:${left};top:${top}"><span class="flag">${flag}</span></span>`).join("");
  } else {
    extras = `<span class="glow-bg"></span>`;
  }
  return `<div class="orbit">${extras}<div data-mascot="215" data-mood="${mood}"></div></div>`;
}

function goIntro(index = 0) {
  const s = SLIDES[index];
  render(`
    <section class="screen">
      <div class="screen-body">
        ${orbitHtml(s.orbit, s.mood)}
        ${s.tag ? `<span class="tag" style="margin-bottom:16px">${s.tag}</span>` : ""}
        <h1 class="hero">${esc(s.h)}</h1>
        ${s.p ? `<p class="sub">${esc(s.p)}</p>` : ""}
      </div>
      <div class="screen-foot">
        <div class="dots">${SLIDES.map((_, i) => `<span class="dot ${i === index ? "on" : ""}"></span>`).join("")}</div>
        <button class="btn" id="next">${icon("arrow-right", 18)} continuar</button>
        <p class="small">já tem conta? <button class="link" id="toLogin">entrar</button></p>
      </div>
    </section>`);
  $("#next").onclick = () => (index + 1 < SLIDES.length ? goIntro(index + 1) : goProof());
  $("#toLogin").onclick = () => goAuth("login");
}

// ---------- prova social ----------

const TESTIMONIALS = [
  { name: "Marina", when: "hoje", route: "🇧🇷 → 🇺🇸 Estados Unidos", text: "Em 3 semanas pedi comida em inglês sem travar. A Mel me xingou no caminho inteiro, mas funcionou." },
  { name: "Rafael", when: "há 1 dia", route: "🇧🇷 → 🇮🇪 Irlanda", text: "Nunca ri tanto errando. É o único app de inglês que eu abro todo dia." },
  { name: "Camila", when: "há 2 dias", route: "🇧🇷 → 🇨🇦 Canadá", text: "Cinco minutos por dia. Foi a primeira vez que não larguei um app de inglês na segunda semana." },
];

function goProof() {
  render(`
    <section class="screen">
      <div class="screen-body top">
        <div class="proof-head">
          <div data-mascot="96" data-mood="happy"></div>
          <div class="txt">
            <h2 class="title">Quem já treina com a Mel</h2>
            <p>não aguenta mais ela — mas parou de travar em inglês.</p>
          </div>
        </div>
        <p class="hint" style="margin:0 0 12px">exemplos — troque pelos seus alunos reais</p>
        ${TESTIMONIALS.map((t) => `
          <div class="tcard">
            <div class="who">
              <div class="avatar">${esc(t.name[0])}</div>
              <div>
                <div class="name">${esc(t.name)}</div>
                <div><span class="stars">★★★★★</span><span class="meta">${esc(t.when)}</span></div>
                <div class="meta" style="margin:2px 0 0">${esc(t.route)}</div>
              </div>
            </div>
            <p>${esc(t.text)}</p>
          </div>`).join("")}
      </div>
      <div class="screen-foot">
        <button class="btn" id="next">${icon("arrow-right", 18)} continuar</button>
      </div>
    </section>`);
  $("#next").onclick = () => goQuestion(0);
}

// ---------- perguntas ----------

function optionIcon(opt) {
  if (opt.mascot) return `<span data-mascot="40" data-mood="${opt.mascot}"></span>`;
  if (opt.icon) return icon(opt.icon, 22);
  const bars = [0, 1, 2, 3].map((i) => `<i class="${i < opt.bars ? "on" : ""}" style="height:${6 + i * 4}px"></i>`).join("");
  return `<span class="levelbars">${bars}</span>`;
}

function goQuestion(index) {
  const q = QUESTIONS[index];
  const answers = state.onboarding;
  let selected = answers[q.id] ?? null;
  render(`
    <section class="screen">
      <div class="screen-body top">
        ${q.eyebrow ? `<p class="eyebrow">${esc(q.eyebrow(answers))}</p>` : ""}
        <div class="ask">
          <div data-mascot="70" data-mood="grumpy"></div>
          <div class="bubble">${esc(q.q)}</div>
        </div>
        <div id="opts">
          ${q.opts.map((o) => `<button class="opt ${o.v === selected ? "on" : ""}" data-v="${o.v}"><span class="ic ${o.mascot ? "big" : ""}">${optionIcon(o)}</span><span>${esc(o.t)}${o.d ? `<small>${esc(o.d)}</small>` : ""}</span></button>`).join("")}
        </div>
        ${q.hint ? `<p class="hint">${esc(q.hint)}</p>` : ""}
      </div>
      <div class="screen-foot">
        <button class="btn" id="next" ${selected ? "" : "disabled"}>Continuar</button>
      </div>
    </section>`);

  $$("#opts .opt").forEach((btn) => {
    btn.onclick = () => {
      selected = btn.dataset.v;
      $$("#opts .opt").forEach((b) => b.classList.toggle("on", b === btn));
      $("#next").disabled = false;
    };
  });
  $("#next").onclick = () => {
    state.onboarding = { ...state.onboarding, [q.id]: selected };
    store.set("onboarding", state.onboarding);
    index + 1 < QUESTIONS.length ? goQuestion(index + 1) : goPlan();
  };
}

// ---------- plano / previsao / compromisso ----------

function goPlan() {
  state.onboarding = { ...state.onboarding, done: true };
  store.set("onboarding", state.onboarding);
  render(`
    <section class="screen">
      <div class="screen-body">
        <p class="eyebrow">seu plano</p>
        <div data-mascot="120" data-mood="neutral" style="margin-bottom:14px"></div>
        <h2 class="title">Sua rotina com a Mel</h2>
        <p class="sub">Todo dia, um ciclo curto. Sem desculpa.</p>
        <div class="plan-steps">
          <div class="step"><span class="n">01</span><div><b>Aquecimento</b><span>2 min — frases-alvo do dia</span></div></div>
          <div class="step"><span class="n">02</span><div><b>Conversa livre</b><span>3 min — você fala, ela corrige (e reclama)</span></div></div>
          <div class="step"><span class="n">03</span><div><b>Revisão</b><span>1 min — o que ficou, o que voltou</span></div></div>
        </div>
      </div>
      <div class="screen-foot">
        <button class="btn" id="next">${icon("arrow-right", 18)} ver minha previsão</button>
      </div>
    </section>`);
  $("#next").onclick = goProjection;
}

function goProjection() {
  const { dateLabel, goal } = projection();
  render(`
    <section class="screen">
      <div class="screen-body">
        <div data-mascot="110" data-mood="happy" style="margin-bottom:18px"></div>
        <h2 class="title" style="max-width:320px">Se você mantiver 5 min por dia, em <span class="mono-date">${esc(dateLabel)}</span> você ${esc(goal)}.</h2>
        <div class="chart">
          <p class="eyebrow" style="text-align:left;margin:0 0 6px">confiança pra falar</p>
          <svg viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true">
            <path class="grid" d="M0 20H300M0 50H300M0 80H300M0 110H300"/>
            <path class="curve" d="M4 112 C 80 108, 120 48, 190 26 S 270 12, 296 10"/>
            <circle cx="296" cy="10" r="4.5"/>
          </svg>
          <div class="axis"><span>hoje</span><span>${esc(dateLabel)}</span></div>
        </div>
      </div>
      <div class="screen-foot">
        <button class="btn" id="next">${icon("arrow-right", 18)} continuar</button>
      </div>
    </section>`);
  $("#next").onclick = goCommit;
}

function goCommit() {
  render(`
    <section class="screen">
      <div class="screen-body">
        <div class="orbit"><span class="glow-bg"></span><button class="tap" id="commit" aria-label="tocar na Mel"><div data-mascot="215" data-mood="neutral"></div></button></div>
        <div class="bubble bubble-top">Topa falar comigo 5 minutos por dia, 5 dias por semana?</div>
        <p class="sub" style="margin-top:16px">Sem meta, sem nota. Só aparecer e falar comigo.</p>
        <p class="hint" id="commitHint" style="margin-top:22px">toque na Mel pra se comprometer</p>
      </div>
      <div class="screen-foot"><p class="small">já tem conta? <button class="link" id="toLogin">entrar</button></p></div>
    </section>`);
  $("#toLogin").onclick = () => goAuth("login");
  $("#commit").onclick = () => {
    Mascot.setMood($("#commit .mascot"), "happy");
    $("#commitHint").textContent = "fechado. agora não tem volta.";
    setTimeout(() => goAuth("register"), 1000);
  };
}

// ---------- conta ----------

function goAuth(mode) {
  const isLogin = mode === "login";
  render(`
    <section class="screen">
      <div class="screen-body top">
        <div style="text-align:center;margin:18px 0 22px">
          <h1 class="hero" style="margin-bottom:6px">Mel</h1>
          <p class="sub">${isLogin ? "Entre pra continuar praticando com a Mel." : "Crie sua conta pra Mel começar a te cobrar em inglês."}</p>
        </div>
        <form id="form" novalidate>
          ${isLogin ? "" : `<div class="field"><label>Nome</label><input name="name" type="text" placeholder="como a Mel deve te chamar" autocomplete="name" /></div>`}
          <div class="field"><label>E-mail</label><input name="email" type="email" placeholder="voce@email.com" autocomplete="email" required /></div>
          <div class="field"><label>Senha</label>
            <div class="inwrap"><input name="password" type="password" placeholder="${isLogin ? "••••••••" : "mínimo 6 caracteres"}" autocomplete="${isLogin ? "current-password" : "new-password"}" required />
            <button type="button" class="iconbtn" id="eye" aria-label="mostrar senha">${icon("eye", 18)}</button></div>
          </div>
          ${isLogin ? `<a class="form-link" href="#" id="forgot">Esqueci minha senha</a>` : ""}
          <button class="btn" type="submit">${isLogin ? "Entrar" : "Criar conta"}</button>
          <p class="error" id="err"></p>
        </form>
        <p class="small">${isLogin ? `Ainda não tem conta? <button class="link" id="switch">Criar conta</button>` : `Já tem conta? <button class="link" id="switch">Entrar</button>`}</p>
      </div>
    </section>`);

  $("#switch").onclick = () => goAuth(isLogin ? "register" : "login");
  $("#eye").onclick = () => {
    const input = $("input[name=password]");
    input.type = input.type === "password" ? "text" : "password";
    $("#eye").innerHTML = icon(input.type === "password" ? "eye" : "eye-slash", 18);
  };
  if ($("#forgot")) $("#forgot").onclick = (e) => { e.preventDefault(); $("#err").textContent = "Recuperação de senha ainda não existe no MVP."; };

  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    if (!isLogin) {
      const { voiceMode, level, blocker, tone } = state.onboarding;
      body.profile = { voiceMode, level, blocker, tone };
    }
    $("#err").textContent = "";
    try {
      const res = await fetch(isLogin ? "/api/auth/login" : "/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "erro desconhecido");
      state.token = data.token;
      state.name = data.name || data.email;
      store.set("token", state.token);
      store.set("name", state.name);
      goHome();
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

// ---------- home / licoes ----------

async function goHome() {
  render(`
    <section class="screen">
      <div class="topbar">
        <div class="brand"><div data-mascot="28" data-mood="grumpy"></div> Mel</div>
        <div class="who"><span>${esc(state.name)}</span><button class="iconbtn" id="logout" aria-label="sair">${icon("x", 18)}</button></div>
      </div>
      <div class="screen-body top">
        <div class="greet">
          <div data-mascot="64" data-mood="grumpy"></div>
          <div class="bubble">${esc(GREETINGS[Math.floor(Math.random() * GREETINGS.length)])}</div>
        </div>
        <p class="eyebrow" style="text-align:left;margin:0 0 10px">lições</p>
        <div class="lesson-list" id="list"><p class="small">carregando…</p></div>
      </div>
    </section>`);
  $("#logout").onclick = logout;

  const res = await fetch("/api/lessons", { headers: authHeaders() });
  if (res.status === 401) return logout();
  state.lessons = await res.json();
  $("#list").innerHTML = state.lessons.map((l, i) => `
    <button class="lesson" data-id="${esc(l.id)}">
      <span class="num">${String(i + 1).padStart(2, "0")}</span>
      <div><b>${esc(l.title)}</b><span>${esc(l.focus)}</span>${l.completed ? `<span class="done">${icon("check", 12)} concluída</span>` : ""}</div>
      <span class="go">${icon("arrow-right", 18)}</span>
    </button>`).join("");
  $$("#list .lesson").forEach((btn) => (btn.onclick = () => openLesson(btn.dataset.id)));
}

// ---------- conversa ----------

async function openLesson(lessonId) {
  ensurePlayback();
  const res = await fetch(`/api/lessons/${lessonId}`, { headers: authHeaders() });
  if (res.status === 401) return logout();
  state.currentLesson = await res.json();
  const index = Math.max(0, state.lessons.findIndex((l) => l.id === lessonId));

  render(`
    <section class="screen talk">
      <div class="talk-head">
        <button class="iconbtn" id="back" aria-label="voltar">${icon("arrow-left", 20)}</button>
        <span class="t">conversa ${index + 1} — ${esc(state.currentLesson.title)}</span>
        <span class="timer" id="timer">0:00</span>
      </div>
      <div class="stage-wrap"><div id="stage" data-mascot="150" data-mood="grumpy"></div></div>
      <p class="status" id="status">conectando…</p>
      <div class="say-wrap">
        <p class="eyebrow left">mel</p>
        <div class="say" id="say"><span class="muted">…</span></div>
      </div>
      <div class="transcript compact" id="transcript"></div>
      <div class="answer hidden" id="answer">
        <p class="eyebrow">o que responder</p>
        <div class="answer-en" id="answerEn"></div>
        <div class="answer-pt" id="answerPt"></div>
      </div>
      <div class="mic-wrap">
        <button class="micbtn" id="mic" aria-label="falar">${icon("microphone", 26)}</button>
        <p class="hint" id="micHint">toque para falar</p>
        <button class="link small" id="end">encerrar lição</button>
      </div>
    </section>`);

  $("#back").onclick = () => goHome();
  $("#end").onclick = () => { state.ws?.send(JSON.stringify({ type: "lessonDone" })); goHome(); };
  $("#mic").onclick = () => (state.recording ? stopRecording() : startRecording());

  state.turn = null;
  state.studentLine = null;
  state.startedAt = Date.now();
  state.timer = setInterval(() => {
    const s = Math.floor((Date.now() - state.startedAt) / 1000);
    const el = $("#timer");
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
  connectVoiceSession(lessonId);
}

function setStatus(text, cls = "") {
  const el = $("#status");
  if (!el) return;
  el.textContent = text;
  el.className = `status ${cls}`;
}

function setMood(mood) {
  Mascot.setMood($("#stage"), mood);
}

function connectVoiceSession(lessonId) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/voice?token=${encodeURIComponent(state.token)}&lessonId=${encodeURIComponent(lessonId)}`);
  state.ws = ws;

  ws.onopen = () => setStatus("chamando a Mel…");
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "ready") {
      setStatus("ao vivo", "live");
    } else if (msg.type === "audio") {
      playAudioChunk(msg.data);
    } else if (msg.type === "transcript") {
      msg.role === "tutora" ? tutorSaid(msg.text) : studentSaid(msg.text);
    } else if (msg.type === "turnComplete") {
      if (state.turn) state.turn.done = true;
    } else if (msg.type === "error") {
      setStatus(msg.message, "err");
      pushHistory("sys", msg.message);
    }
  };
  ws.onclose = () => { if (state.ws === ws) setStatus("desconectado"); };
}

// a transcricao chega em pedacos: a fala atual da Mel fica no card grande,
// a anterior desce pro historico compacto
function tutorSaid(text) {
  if (!state.turn || state.turn.done) {
    if (state.turn) pushHistory("tutora", state.turn.raw);
    state.turn = { raw: "", done: false };
    state.studentLine = null;
  }
  state.turn.raw += text;
  const say = $("#say");
  if (say) say.innerHTML = fmt(state.turn.raw);
  updateAnswer(parseDictation(state.turn.raw));
}

function studentSaid(text) {
  const box = $("#transcript");
  if (!box) return;
  if (state.studentLine) {
    state.studentLine.raw += text;
    state.studentLine.el.textContent = state.studentLine.raw;
  } else {
    const el = document.createElement("div");
    el.className = "line aluno";
    el.textContent = text;
    box.appendChild(el);
    state.studentLine = { el, raw: text };
  }
  box.classList.add("has");
  box.scrollTop = box.scrollHeight;
}

function pushHistory(role, text) {
  const box = $("#transcript");
  if (!box || !text) return;
  const el = document.createElement("div");
  el.className = `line ${role}`;
  el.innerHTML = fmt(text);
  box.appendChild(el);
  box.classList.add("has");
  box.scrollTop = box.scrollHeight;
}

// "Diz: <frase em ingles>. Em portugues: <traducao>." -> card "o que responder"
function parseDictation(raw) {
  const idx = raw.search(/\bdiz\s*:/i);
  if (idx < 0) return null;
  let rest = raw.slice(idx).replace(/^diz\s*:\s*/i, "").replace(/\*/g, "");
  let pt = "";
  const split = rest.match(/^(.*?)\s*(?:\.\s*)?em\s+portugu[eê]s\s*:\s*(.*)$/i);
  if (split) {
    rest = split[1];
    // a traducao tem o mesmo numero de frases que o ingles; o resto e a Mel continuando a falar
    const sentences = Math.max(1, (rest.match(/[.!?](?=\s|$)/g) || []).length);
    pt = split[2].split(/(?<=[.!?])\s/).slice(0, sentences).join(" ");
  }
  else { const paren = rest.match(/^(.*?)\s*\((.+?)\)/); if (paren) { rest = paren[1]; pt = paren[2]; } }
  rest = rest.replace(/^["“«']+|["”»']+$/g, "").trim();
  return rest ? { en: rest, pt: pt.trim() } : null;
}

function updateAnswer(d) {
  const card = $("#answer");
  if (!card) return;
  if (!d) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  $("#answerEn").textContent = d.en;
  $("#answerPt").textContent = d.pt;
}

function stopVoiceSession() {
  stopRecording();
  if (state.ws) { const ws = state.ws; state.ws = null; ws.close(); }
  clearTimeout(state.moodTimer);
  clearInterval(state.timer);
}

// captura o microfone, faz downsample para 16kHz mono PCM16 e envia via WebSocket
async function startRecording() {
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    setStatus("microfone bloqueado — libere no navegador", "err");
    return;
  }
  state.audioCtx = new AudioContext();
  const source = state.audioCtx.createMediaStreamSource(state.micStream);
  state.processorNode = state.audioCtx.createScriptProcessor(4096, 1, 1);
  state.processorNode.onaudioprocess = (e) => {
    const pcm16 = downsampleTo16kHz(e.inputBuffer.getChannelData(0), state.audioCtx.sampleRate);
    state.ws?.send(JSON.stringify({ type: "audio", data: int16ToBase64(pcm16) }));
  };
  source.connect(state.processorNode);
  state.processorNode.connect(state.audioCtx.destination);

  state.recording = true;
  state.studentLine = null;
  $("#mic")?.classList.add("on");
  const hint = $("#micHint");
  if (hint) hint.textContent = "toque quando terminar";
  setMood("listening");
  setStatus("ouvindo — pode falar, ela responde sozinha", "live");
}

function stopRecording() {
  if (!state.recording) return;
  state.processorNode?.disconnect();
  state.audioCtx?.close();
  state.micStream?.getTracks().forEach((t) => t.stop());
  state.ws?.send(JSON.stringify({ type: "audioStreamEnd" }));
  state.recording = false;
  $("#mic")?.classList.remove("on");
  const hint = $("#micHint");
  if (hint) hint.textContent = "toque para falar";
  setMood("grumpy");
  setStatus("a Mel está pensando…", "live");
}

function downsampleTo16kHz(input, inputRate) {
  const target = 16000;
  if (inputRate === target) return floatTo16Bit(input);
  const ratio = inputRate / target;
  const out = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const idx = i * ratio, i0 = Math.floor(idx), i1 = Math.min(i0 + 1, input.length - 1), frac = idx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return floatTo16Bit(out);
}

function floatTo16Bit(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return i16;
}

function int16ToBase64(i16) {
  const bytes = new Uint8Array(i16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---------- playback do audio da Mel (PCM16, 24kHz) ----------

function ensurePlayback() {
  if (!state.playbackCtx) {
    state.playbackCtx = new AudioContext({ sampleRate: 24000 });
    state.nextPlaybackTime = 0;
  }
  if (state.playbackCtx.state === "suspended") state.playbackCtx.resume();
}

function playAudioChunk(base64) {
  ensurePlayback();
  const ctx = state.playbackCtx;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;

  const buffer = ctx.createBuffer(1, f32.length, 24000);
  buffer.copyToChannel(f32, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  const startAt = Math.max(state.nextPlaybackTime, ctx.currentTime + 0.02);
  src.start(startAt);
  state.nextPlaybackTime = startAt + buffer.duration;

  setMood("talking");
  if (!state.recording) setStatus("a Mel está falando", "live");
  clearTimeout(state.moodTimer);
  state.moodTimer = setTimeout(() => {
    setMood(state.recording ? "listening" : "grumpy");
    if (!state.recording) setStatus("sua vez", "live");
  }, (state.nextPlaybackTime - ctx.currentTime) * 1000 + 150);
}

// ---------- bootstrap ----------

if (state.token) goHome();
else if (state.onboarding.done) goAuth("login");
else goIntro(0);
