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
  role: store.get("role", "user"),
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
  { orbit: "icons", mood: "grumpy", clip: "intro1", h: "Oi. Eu sou a Mel.", p: "A professora de inglês que não tem paciência nenhuma — mas que faz você falar." },
  { orbit: "flags", mood: "neutral", clip: "intro2", h: "3 minutos por dia de conversa. Sem enrolação.", p: "" },
  { orbit: "glow", mood: "happy", clip: "intro3", tag: "🇧🇷 BRASIL", h: "Sua professora de IA particular.", p: "Disponível a qualquer hora, em qualquer lugar. Mal-humorada em todos eles." },
];

const QUESTIONS = [
  {
    id: "voiceMode", clip: "q_voice",
    q: "Antes de começar: como você prefere me ouvir?",
    hint: "Você pode mudar isso depois.",
    opts: [
      { v: "sempre", icon: "speaker-high", t: "Pode falar normalmente" },
      { v: "exercicios", icon: "speaker-low", t: "Só nos exercícios de fala" },
    ],
  },
  {
    id: "level", clip: "q_level",
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
    id: "blocker", clip: "q_blocker",
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
    id: "tone", clip: "q_tone",
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

const LEVEL_GROUPS = [
  { label: "Iniciante", tag: "A0 – A1", levels: ["A0", "A1"] },
  { label: "Básico", tag: "A2", levels: ["A2"] },
  { label: "Intermediário", tag: "B1", levels: ["B1"] },
  { label: "Avançado", tag: "B2 – C1", levels: ["B2", "C1"] },
];

// ---------- voz da Mel nas telas de entrada (clipes pre-gerados) ----------

const voice = {
  on: store.get("voiceOn", true),
  el: null,
  pending: null, // clipe que o navegador bloqueou (autoplay) e que toca no primeiro toque
  play(name) {
    if (!this.on || !name) return Promise.resolve();
    this.stop();
    const el = (this.el ||= new Audio());
    el.src = `/audio/${name}.wav`;
    el.onplay = () => setAllMoods("talking");
    el.onended = el.onpause = () => setAllMoods(null);
    return el.play();
  },
  // Toca assim que a tela abre. Chrome/Safari bloqueiam som antes do primeiro
  // gesto do usuario na pagina; nesse caso a fala fica pendente e dispara no
  // primeiro toque/clique/tecla em qualquer lugar (o gesto libera o audio pra
  // todas as telas seguintes).
  autoplay(name) {
    this.pending = null;
    this.play(name).catch(() => { this.pending = name; });
  },
  stop() {
    this.pending = null;
    if (this.el) { this.el.onended = this.el.onpause = null; this.el.pause(); }
    setAllMoods(null);
  },
  toggle() {
    this.on = !this.on;
    store.set("voiceOn", this.on);
    if (!this.on) this.stop();
    $$("#voiceBtn").forEach(renderVoiceBtn);
  },
};

// primeiro gesto na pagina: se a Mel foi bloqueada pelo autoplay, ela fala agora
for (const ev of ["pointerdown", "touchend", "keydown"]) {
  document.addEventListener(ev, () => {
    if (voice.pending) { const clip = voice.pending; voice.pending = null; voice.play(clip).catch(() => {}); }
  }, { capture: true, passive: true });
}

function setAllMoods(mood) {
  $$(".mascot[data-base]").forEach((el) => Mascot.setMood(el, mood ?? el.dataset.base));
}

function renderVoiceBtn(btn) {
  btn.innerHTML = icon(voice.on ? "speaker-high" : "speaker-low", 20);
  btn.classList.toggle("muted", !voice.on);
  btn.title = voice.on ? "silenciar a Mel" : "ouvir a Mel";
}

function topMini() {
  return `<div class="topmini center"><button class="iconbtn" id="voiceBtn" aria-label="som"></button></div>`;
}

// ---------- infra de render ----------

function render(html, clip) {
  stopVoiceSession();
  voice.stop();
  app.innerHTML = html;
  $$("[data-mascot]").forEach((el) => {
    Mascot.build(el, { size: Number(el.dataset.mascot), mood: el.dataset.mood || "grumpy" });
    el.dataset.base = el.dataset.mood || "grumpy";
  });
  $$("#voiceBtn").forEach((btn) => { renderVoiceBtn(btn); btn.onclick = () => voice.toggle(); });
  window.scrollTo(0, 0);
  if (clip) voice.autoplay(clip);
  // tocar na Mel repete a fala
  const tappable = $("[data-clip]");
  if (tappable) tappable.onclick = () => voice.play(tappable.dataset.clip).catch(() => {});
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
  store.del("role");
  state.token = null;
  state.name = "";
  state.role = "user";
  goIntro(0);
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

function orbitHtml(kind, mood, clip) {
  let extras = "";
  if (kind === "icons") {
    extras = ORBIT_ICONS.map(([name, size, left, top]) => `<span class="fl" style="left:${left};top:${top}">${icon(name, size)}</span>`).join("");
  } else if (kind === "flags") {
    extras = ORBIT_FLAGS.map(([flag, left, top]) => `<span class="fl" style="left:${left};top:${top}"><span class="flag">${flag}</span></span>`).join("");
  } else {
    extras = `<span class="glow-bg"></span>`;
  }
  return `<div class="orbit">${extras}
    <button class="tap" data-clip="${clip}" aria-label="ouvir a Mel"><div data-mascot="215" data-mood="${mood}"></div></button>
  </div>`;
}

function goIntro(index = 0) {
  const s = SLIDES[index];
  const first = index === 0;
  render(`
    <section class="screen">
      ${topMini()}
      <div class="screen-body">
        ${orbitHtml(s.orbit, s.mood, s.clip)}
        ${s.tag ? `<span class="tag" style="margin-bottom:16px">${s.tag}</span>` : ""}
        <h1 class="hero">${esc(s.h)}</h1>
        ${s.p ? `<p class="sub">${esc(s.p)}</p>` : ""}
      </div>
      <div class="screen-foot">
        <div class="dots">${SLIDES.map((_, i) => `<span class="dot ${i === index ? "on" : ""}"></span>`).join("")}</div>
        <button class="btn" id="next">${icon("arrow-right", 18)} ${first ? "criar minha conta" : "continuar"}</button>
        ${first
          ? `<button class="btn btn-ghost" id="toLogin" style="margin-top:10px">já tenho conta — entrar</button>`
          : `<p class="small">já tem conta? <button class="link" id="toLogin">entrar</button></p>`}
      </div>
    </section>`, s.clip);
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
      ${topMini("onb")}
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
    </section>`, "proof");
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
      ${topMini("onb")}
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
    </section>`, q.clip);

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
      ${topMini("onb")}
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
    </section>`, "plan");
  $("#next").onclick = goProjection;
}

function goProjection() {
  const { dateLabel, goal } = projection();
  render(`
    <section class="screen">
      ${topMini("onb")}
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
    </section>`, "projection");
  $("#next").onclick = goCommit;
}

function goCommit() {
  render(`
    <section class="screen">
      ${topMini("onb")}
      <div class="screen-body">
        <div class="orbit"><span class="glow-bg"></span><button class="tap" id="commit" aria-label="tocar na Mel"><div data-mascot="215" data-mood="neutral"></div></button></div>
        <div class="bubble bubble-top">Topa falar comigo 5 minutos por dia, 5 dias por semana?</div>
        <p class="sub" style="margin-top:16px">Sem meta, sem nota. Só aparecer e falar comigo.</p>
        <p class="hint" id="commitHint" style="margin-top:22px">toque na Mel pra se comprometer</p>
      </div>
      <div class="screen-foot"><p class="small">já tem conta? <button class="link" id="toLogin">entrar</button></p></div>
    </section>`, "commit");
  $("#toLogin").onclick = () => goAuth("login");
  $("#commit").onclick = () => {
    voice.stop();
    const m = $("#commit .mascot");
    m.dataset.base = "happy";
    Mascot.setMood(m, "happy");
    $("#commitHint").textContent = "fechado. agora não tem volta.";
    setTimeout(() => goAuth("register"), 1000);
  };
}

// ---------- conta ----------

function goAuth(mode) {
  const isLogin = mode === "login";
  render(`
    <section class="screen">
      ${topMini("onb")}
      <div class="screen-body top">
        <div class="auth-head">
          <div data-mascot="64" data-mood="${isLogin ? "neutral" : "grumpy"}"></div>
          <div class="bubble">${isLogin ? "Ah, voltou. Entra aí que eu não tenho o dia todo." : "Cria sua conta. Prometo que só vou te cobrar em inglês."}</div>
        </div>
        <form id="form" novalidate>
          ${isLogin ? "" : `<div class="field"><label>Nome</label><input name="name" type="text" placeholder="como a Mel deve te chamar" autocomplete="name" autofocus /></div>`}
          <div class="field"><label>E-mail</label><input name="email" type="email" placeholder="voce@email.com" autocomplete="email" inputmode="email" required ${isLogin ? "autofocus" : ""} /></div>
          <div class="field"><label>Senha</label>
            <div class="inwrap"><input name="password" type="password" placeholder="${isLogin ? "••••••••" : "mínimo 6 caracteres"}" autocomplete="${isLogin ? "current-password" : "new-password"}" required />
            <button type="button" class="iconbtn" id="eye" aria-label="mostrar senha">${icon("eye", 18)}</button></div>
          </div>
          ${isLogin ? `<a class="form-link" href="#" id="forgot">Esqueci minha senha</a>` : ""}
          <button class="btn" type="submit" id="submit">${isLogin ? "Entrar" : "Criar conta"}</button>
          <p class="error" id="err"></p>
        </form>
        <p class="small">${isLogin ? `Ainda não tem conta? <button class="link" id="switch">Criar conta</button>` : `Já tem conta? <button class="link" id="switch">Entrar</button>`}</p>
      </div>
    </section>`, isLogin ? "login" : "register");

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
    if (!body.email || !body.password) { $("#err").textContent = "Preenche e-mail e senha."; return; }
    if (!isLogin) {
      const { voiceMode, level, blocker, tone } = state.onboarding;
      body.profile = { voiceMode, level, blocker, tone };
    }
    const submit = $("#submit");
    submit.classList.add("loading");
    submit.textContent = isLogin ? "entrando…" : "criando…";
    $("#err").textContent = "";
    try {
      const res = await fetch(isLogin ? "/api/auth/login" : "/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "erro desconhecido");
      state.token = data.token;
      state.name = data.name || data.email;
      state.role = data.role ?? "user";
      store.set("token", state.token);
      store.set("name", state.name);
      store.set("role", state.role);
      goHome();
    } catch (err) {
      $("#err").textContent = err.message;
      submit.classList.remove("loading");
      submit.textContent = isLogin ? "Entrar" : "Criar conta";
    }
  };
}

// ---------- home / licoes ----------

async function goHome() {
  render(`
    <section class="screen">
      <div class="topbar">
        <div class="brand"><div data-mascot="28" data-mood="grumpy"></div> Mel</div>
        <div class="who">${state.role === "admin" ? `<a class="pill" href="/admin">painel</a>` : ""}<span>${esc(state.name)}</span><button class="iconbtn" id="logout" aria-label="sair">${icon("x", 18)}</button></div>
      </div>
      <div class="screen-body top">
        <div class="greet">
          <div data-mascot="64" data-mood="grumpy"></div>
          <div class="bubble">${esc(GREETINGS[Math.floor(Math.random() * GREETINGS.length)])}</div>
        </div>
        <div class="plan-line" id="planLine"></div>
        <div id="list"><p class="small">carregando…</p></div>
      </div>
    </section>`);
  $("#logout").onclick = logout;

  fetch("/api/pay/me", { headers: authHeaders() }).then((r) => r.ok && r.json()).then((ent) => {
    if (!ent || !$("#planLine")) return;
    state.entitlement = ent;
    $("#planLine").innerHTML = ent.free
      ? `<span class="chip">grátis · ${ent.minutesPerDay} min/dia · usou ${ent.usedToday}</span> <button class="pill small" id="upgrade">assinar</button>`
      : `<span class="chip">${esc(ent.planName)} · até ${new Date(ent.expiresAt).toLocaleDateString("pt-BR")}</span>`;
    if ($("#upgrade")) $("#upgrade").onclick = () => goPaywall("upgrade");
  });

  const res = await fetch("/api/lessons", { headers: authHeaders() });
  if (res.status === 401) return logout();
  state.lessons = await res.json();

  renderTrail();
}

// ---------- trilha de cenários (home) ----------

// icones de reserva por posicao, quando a licao nao traz o seu proprio (`icon` no JSON)
const TRAIL_ICONS = ["microphone", "users", "coffee", "fork-knife", "compass", "book-open", "chat-circle-dots", "chats-circle", "lightning", "mask-sad", "chart-line", "briefcase", "star-four", "guitar", "fire"];
const TRAIL = { node: 64, nodeNow: 72, stepY: 88, labelY: 46, amp: 58 };

function renderTrail() {
  const lessons = state.lessons;
  if (!lessons.length) { $("#list").innerHTML = `<p class="small">nenhuma lição publicada ainda.</p>`; return; }
  const nowIdx = Math.max(0, lessons.findIndex((l) => !l.completed));
  const current = lessons.findIndex((l) => !l.completed) === -1 ? -1 : nowIdx;

  // monta a sequencia: divisoria de nivel + nós, em ordem
  const rows = [];
  let n = 0;
  for (const g of LEVEL_GROUPS) {
    const items = lessons.filter((l) => g.levels.includes(l.level));
    if (!items.length) continue;
    rows.push({ type: "label", text: `${g.label} · ${g.tag}` });
    for (const l of items) rows.push({ type: "node", lesson: l, index: n++ });
  }

  // posiciona: zigue-zague suave (0, +amp, 0, -amp, ...)
  let y = 12;
  const nodes = [];
  const html = rows.map((r) => {
    if (r.type === "label") {
      const out = `<span class="trail-label" style="top:${y}px">${esc(r.text)}</span>`;
      y += TRAIL.labelY;
      return out;
    }
    const cx = Math.round(Math.sin((r.index * Math.PI) / 2) * TRAIL.amp);
    const cy = y + TRAIL.node / 2;
    nodes.push({ cx, cy, index: r.index });
    y += TRAIL.stepY;
    const l = r.lesson;
    const cls = ["trail-node", l.completed ? "done" : "", r.index === current ? "now" : "", !l.completed && r.index !== current ? "next" : ""].join(" ");
    const ic = l.icon && window.ICONS[l.icon] ? l.icon : TRAIL_ICONS[r.index % TRAIL_ICONS.length];
    return `<button class="${cls}" data-id="${esc(l.id)}" style="left:calc(50% + ${cx}px);top:${cy}px" aria-label="${esc(l.title)}">
      ${icon(ic, 26)}${l.completed ? `<span class="tick">${icon("check", 11)}</span>` : ""}
      ${r.index === current ? `<span class="today">HOJE</span>` : ""}
    </button>`;
  }).join("");

  // linha tracejada ligando nós consecutivos (em coordenadas relativas ao centro)
  const W = 390;
  const path = nodes.map((p, i) => `${i ? "L" : "M"}${W / 2 + p.cx} ${p.cy}`).join(" ");
  $("#list").innerHTML = `
    <p class="eyebrow left trail-title">cenários</p>
    <div class="trail" style="height:${y}px">
      <svg class="trail-line" viewBox="0 0 ${W} ${y}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>
      ${html}
    </div>
    <div class="trail-card" id="trailCard"></div>`;

  const select = (id) => {
    const l = lessons.find((x) => x.id === id);
    $$(".trail-node").forEach((b) => b.classList.toggle("sel", b.dataset.id === id));
    $("#trailCard").innerHTML = `
      <div class="tc-head"><span class="lvl">${esc(l.level)}</span>${l.completed ? `<span class="tc-done">${icon("check", 12)} concluída</span>` : ""}</div>
      <b>${esc(l.title)}</b>
      <p>${esc(l.focus)}</p>
      <button class="btn" id="startLesson">${l.completed ? "repetir cenário" : "conversar com a Mel"} ${icon("arrow-right", 18)}</button>`;
    $("#startLesson").onclick = () => openLesson(id);
  };
  $$(".trail-node").forEach((b) => (b.onclick = () => select(b.dataset.id)));
  select(lessons[current === -1 ? lessons.length - 1 : current].id);
  if (current > 2) $(".trail-node.now")?.scrollIntoView({ block: "center" });
}

// ---------- planos / pix ----------

const brl = (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

async function goPaywall(reason) {
  const ent = state.entitlement ?? {};
  const bubble = reason === "limit"
    ? `Acabou seu tempo de hoje${ent.free ? ` (${ent.minutesPerDay} min grátis)` : ""}. Quer mais? Paga. Eu também não trabalho de graça.`
    : "Escolhe quanto você aguenta de mim por dia.";
  render(`
    <section class="screen">
      <div class="talk-head"><button class="iconbtn" id="back" aria-label="voltar">${icon("arrow-left", 20)}</button><span class="t">planos</span></div>
      <div class="screen-body top">
        <div class="ask"><div data-mascot="70" data-mood="grumpy"></div><div class="bubble">${esc(bubble)}</div></div>
        <div id="plans"><p class="small">carregando…</p></div>
      </div>
      <div class="screen-foot"><button class="btn" id="next" disabled>continuar</button></div>
    </section>`);
  $("#back").onclick = goHome;
  const res = await fetch("/api/pay/plans");
  const { plans, pixConfigured } = await res.json();
  let chosen = null;
  $("#plans").innerHTML = plans.map((p) => `
    <button class="plan-card" data-id="${esc(p.id)}">
      <div><b>${esc(p.name)}</b><span>${esc(p.description ?? "")}</span></div>
      <div class="price">${brl(p.priceCents)}<small>por ${p.days} dias</small></div>
    </button>`).join("") + (pixConfigured ? "" : `<p class="hint">pagamento por pix ainda não liberado — em breve</p>`);
  $$(".plan-card").forEach((b) => (b.onclick = () => {
    chosen = plans.find((p) => p.id === b.dataset.id);
    $$(".plan-card").forEach((x) => x.classList.toggle("on", x === b));
    $("#next").disabled = !pixConfigured;
  }));
  $("#next").onclick = () => chosen && goCheckout(chosen);
}

function goCheckout(plan) {
  render(`
    <section class="screen">
      <div class="talk-head"><button class="iconbtn" id="back" aria-label="voltar">${icon("arrow-left", 20)}</button><span class="t">pagar com pix</span></div>
      <div class="screen-body top">
        <div class="ask"><div data-mascot="70" data-mood="neutral"></div><div class="bubble">${esc(plan.name)} por ${brl(plan.priceCents)}. Preciso desses dados pra gerar o Pix — exigência do banco, não minha.</div></div>
        <form id="form" novalidate>
          <div class="field"><label>Nome completo</label><input name="name" value="${esc(state.name)}" autocomplete="name" required /></div>
          <div class="field"><label>CPF</label><input name="cpf" inputmode="numeric" placeholder="000.000.000-00" autocomplete="off" required /></div>
          <div class="field"><label>Celular com DDD</label><input name="phone" inputmode="tel" placeholder="11 99999-8888" autocomplete="tel" required /></div>
          <button class="btn" type="submit" id="submit">gerar pix de ${brl(plan.priceCents)}</button>
          <p class="error" id="err"></p>
        </form>
      </div>
    </section>`);
  $("#back").onclick = () => goPaywall("upgrade");
  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const submit = $("#submit");
    submit.classList.add("loading"); submit.textContent = "gerando pix…";
    $("#err").textContent = "";
    try {
      const res = await fetch("/api/pay/pix", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id, ...f }) });
      const order = await res.json();
      if (!res.ok) throw new Error(order.error || "erro ao gerar o pix");
      goPix(order, plan);
    } catch (err) {
      $("#err").textContent = err.message;
      submit.classList.remove("loading"); submit.textContent = `gerar pix de ${brl(plan.priceCents)}`;
    }
  };
}

function goPix(order, plan) {
  render(`
    <section class="screen">
      <div class="talk-head"><button class="iconbtn" id="back" aria-label="voltar">${icon("arrow-left", 20)}</button><span class="t">pix · ${brl(order.amountCents)}</span></div>
      <div class="screen-body top">
        <p class="sub" style="text-align:center;max-width:none">Abre o app do seu banco, escolhe <b>Pix Copia e Cola</b> (ou lê o QR) e confirma. Eu libero na hora.</p>
        ${order.qrPng ? `<div class="qr-box"><img src="${esc(order.qrPng)}" alt="QR code do pix" /></div>` : ""}
        <div class="copy-row"><textarea id="qrText" readonly>${esc(order.qrText ?? "")}</textarea><button class="btn" id="copy">copiar</button></div>
        <p class="pay-status" id="payStatus">aguardando pagamento…</p>
        <p class="hint" style="margin-top:14px">vale até ${new Date(order.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </section>`);
  $("#back").onclick = goHome;
  $("#copy").onclick = async () => {
    try { await navigator.clipboard.writeText(order.qrText ?? ""); $("#copy").textContent = "copiado"; } catch { $("#qrText").select(); }
  };
  const poll = setInterval(async () => {
    if (!$("#payStatus")) return clearInterval(poll);
    try {
      const res = await fetch(`/api/pay/status/${encodeURIComponent(order.orderId)}`, { headers: authHeaders() });
      const s = await res.json();
      if (s.status === "PAID") {
        clearInterval(poll);
        $("#payStatus").textContent = "pago — liberado";
        $("#payStatus").classList.add("ok");
        setTimeout(goHome, 1500);
      } else if (s.status === "DECLINED" || s.status === "CANCELED") {
        clearInterval(poll);
        $("#payStatus").textContent = "pagamento não concluído";
      }
    } catch {}
  }, 4000);
}

// ---------- conversa ----------

async function openLesson(lessonId) {
  // os dois AudioContext nascem aqui, dentro do clique: criados fora de um gesto
  // do usuario o Chrome deixa eles suspensos e o microfone captura em silencio
  ensurePlayback();
  ensureCapture();
  const res = await fetch(`/api/lessons/${lessonId}`, { headers: authHeaders() });
  if (res.status === 401) return logout();
  state.currentLesson = await res.json();

  // Tela limpa: so a Mel no centro e a frase que o aluno tem que repetir.
  // Sem botao de microfone (ele fica sempre aberto), sem transcricao, sem status —
  // o unico texto extra e um aviso quando o microfone e bloqueado.
  render(`
    <section class="screen talk zen">
      <div class="talk-head"><button class="iconbtn" id="back" aria-label="sair da aula">${icon("arrow-left", 22)}</button></div>
      <div class="zen-body">
        <div class="stage-wrap" id="stageWrap"><div id="stage" data-mascot="210" data-mood="grumpy"></div></div>
        <p class="status" id="status"></p>
        <div class="answer hidden" id="answer">
          <div class="answer-en" id="answerEn"></div>
          <div class="answer-pt" id="answerPt"></div>
        </div>
      </div>
    </section>`);

  $("#back").onclick = () => goHome();

  state.turn = null;
  state.studentLine = null;
  state.startedAt = Date.now();
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
      startRecording(); // conversa continua: microfone abre sozinho, sem toque
    } else if (msg.type === "audio") {
      playAudioChunk(msg.data);
    } else if (msg.type === "transcript") {
      msg.role === "tutora" ? tutorSaid(msg.text) : studentSaid(msg.text);
    } else if (msg.type === "interrupted") {
      flushPlayback();
      if (state.turn) state.turn.done = true;
    } else if (msg.type === "turnComplete") {
      if (state.turn) state.turn.done = true;
    } else if (msg.type === "limit") {
      state.entitlement = msg;
      goPaywall("limit");
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
    const sentences = rest.split(/(?<=[.!?])\s+/).filter(Boolean).length || 1;
    pt = split[2].split(/(?<=[.!?])\s/).slice(0, sentences).join(" ");
  }
  else { const paren = rest.match(/^(.*?)\s*\((.+?)\)/); if (paren) { rest = paren[1]; pt = paren[2]; } }
  rest = rest.replace(/^["“«']+|["”»']+$/g, "").trim();
  return rest ? { en: rest, pt: pt.trim() } : null;
}

// a frase fica na tela ate a Mel ditar outra (o aluno precisa dela enquanto repete);
// quando a Mel fala sem ditar nada, a frase anterior so esmaece
function updateAnswer(d) {
  const card = $("#answer");
  if (!card) return;
  if (!d) { card.classList.add("dim"); return; }
  card.classList.remove("hidden", "dim");
  $("#answerEn").textContent = d.en;
  $("#answerPt").textContent = d.pt;
}

function stopVoiceSession() {
  stopRecording();
  if (state.ws) { const ws = state.ws; state.ws = null; ws.close(); }
  clearTimeout(state.moodTimer);
}

// captura o microfone, faz downsample para 16kHz mono PCM16 e envia via WebSocket
async function startRecording() {
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    setStatus("libere o microfone no navegador e abra a aula de novo", "err");
    return;
  }
  const ctx = ensureCapture();
  await resumeCtx(ctx);
  const source = ctx.createMediaStreamSource(state.micStream);
  state.sourceNode = source;
  state.processorNode = ctx.createScriptProcessor(4096, 1, 1);
  let loud = false;
  state.processorNode.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const pcm16 = downsampleTo16kHz(input, ctx.sampleRate);
    state.ws?.send(JSON.stringify({ type: "audio", data: int16ToBase64(pcm16) }));
    // a Mel "reage" quando ouve voz: feedback visual de que o microfone esta captando
    let sum = 0;
    for (let i = 0; i < input.length; i += 8) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / (input.length / 8));
    const now = rms > 0.02;
    if (now !== loud) { loud = now; $("#stageWrap")?.classList.toggle("hear", loud); }
  };
  source.connect(state.processorNode);
  state.processorNode.connect(ctx.destination);

  state.recording = true;
  state.studentLine = null;
  setMood("listening");
  setStatus("ouvindo", "live");
}

function stopRecording() {
  if (!state.recording) return;
  state.processorNode?.disconnect();
  state.sourceNode?.disconnect();
  state.micStream?.getTracks().forEach((t) => t.stop());
  state.ws?.send(JSON.stringify({ type: "audioStreamEnd" }));
  state.recording = false;
  $("#stageWrap")?.classList.remove("hear");
  setMood("grumpy");
  setStatus("", "");
}

function ensureCapture() {
  return (state.captureCtx ||= new AudioContext());
}

// tenta retomar o contexto; se o navegador exigir gesto, retoma no proximo toque
async function resumeCtx(ctx) {
  if (ctx.state === "running") return;
  try { await ctx.resume(); } catch {}
  if (ctx.state !== "running") {
    const once = () => { ctx.resume().catch(() => {}); };
    for (const ev of ["pointerdown", "touchend", "keydown"]) document.addEventListener(ev, once, { once: true, capture: true });
  }
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
  (state.playing ||= new Set()).add(src);
  src.onended = () => state.playing?.delete(src);

  setMood("talking");
  setStatus("a Mel está falando", "live");
  clearTimeout(state.moodTimer);
  state.moodTimer = setTimeout(() => {
    setMood(state.recording ? "listening" : "grumpy");
    setStatus(state.recording ? "sua vez — é só falar" : "mudo", state.recording ? "live" : "");
  }, (state.nextPlaybackTime - ctx.currentTime) * 1000 + 150);
}

// o aluno falou por cima da Mel: descarta o que ainda ia tocar
function flushPlayback() {
  state.playing?.forEach((src) => { try { src.stop(); } catch {} });
  state.playing?.clear();
  state.nextPlaybackTime = 0;
  clearTimeout(state.moodTimer);
  setMood(state.recording ? "listening" : "grumpy");
  setStatus("ouvindo", "live");
}

// ---------- bootstrap ----------

// deslogado = sempre a Mel na porta, como no app de referencia
if (state.token) goHome();
else goIntro(0);
