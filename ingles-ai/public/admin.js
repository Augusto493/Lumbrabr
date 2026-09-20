const app = document.getElementById("app");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function appToken() {
  try { return JSON.parse(localStorage.getItem("token")); } catch { return null; }
}
let token = sessionStorage.getItem("adminToken") || appToken();
let data = null;
let tab = sessionStorage.getItem("adminTab") || "overview";
let preview = null;

const LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1"];
const LEVEL_LABEL = { A0: "iniciante", A1: "iniciante", A2: "básico", B1: "intermediário", B2: "avançado", C1: "avançado" };
const TONE_LABEL = { braba: "braba", deboa: "de boa" };
const BLOCKER_LABEL = { vergonha: "vergonha", congelo: "congelo", nao_sei: "não sei por onde começar", falta_gente: "falta gente" };
const STUDENT_LEVELS = { zero: "não sabe nada", basico: "palavras comuns", simples: "conversas simples", variado: "assuntos variados", fluente: "quase fluente" };
const STATUS_LABEL = { PAID: "pago", WAITING: "aguardando", DECLINED: "recusado", CANCELED: "cancelado" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (cents) => `R$ ${(Number(cents || 0) / 100).toFixed(2).replace(".", ",")}`;
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const dateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

async function api(method, path, body) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { sessionStorage.removeItem("adminToken"); token = null; showLogin(""); throw new Error("acesso negado"); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `erro ${res.status}`);
  return json;
}

function mount(html) {
  app.innerHTML = html;
  $$("[data-mascot]").forEach((el) => Mascot.build(el, { size: Number(el.dataset.mascot), mood: el.dataset.mood || "grumpy" }));
}

// No celular as tabelas viram cartoes (CSS): cada celula ganha o titulo da
// coluna em data-label e o conteudo vai pra um <span class="cell">. Os nos sao
// movidos, nao recriados, pra nao perder os onclick ja ligados.
function labelTables() {
  $$("table").forEach((table) => {
    const heads = $$("thead th", table).map((th) => th.textContent.trim());
    $$("tbody tr", table).forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (td.dataset.labeled) return;
        td.dataset.labeled = "1";
        if (td.hasAttribute("colspan")) return;
        td.dataset.label = heads[i] ?? "";
        if (!heads[i]) td.classList.add("no-label");
        const cell = document.createElement("span");
        cell.className = "cell";
        while (td.firstChild) cell.appendChild(td.firstChild);
        td.appendChild(cell);
      });
    });
  });
}
new MutationObserver(labelTables).observe(app, { childList: true, subtree: true });

function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = `toast ${isError ? "err" : ""}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function modal(html) {
  closeModal();
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.id = "modal";
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.onclick = (e) => { if (e.target === bg) closeModal(); };
  document.body.appendChild(bg);
  return bg;
}
function closeModal() { $("#modal")?.remove(); }

// ---------- login ----------

function showLogin(error = "") {
  mount(`
    <div class="admin-login">
      <div data-mascot="90" data-mood="neutral"></div>
      <h1 class="hero" style="margin-top:14px">Painel da Mel</h1>
      <p class="sub">Só quem manda nela entra aqui. Se sua conta é admin, <a href="/" style="color:var(--ink)">entra no app</a> e volta.</p>
      <form id="form" class="admin-form">
        <div class="field"><label>Senha do painel</label><input name="password" type="password" autofocus required /></div>
        <button class="btn" type="submit">Entrar</button>
        <p class="error" id="err">${esc(error)}</p>
      </form>
    </div>`);
  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const password = new FormData(e.target).get("password");
    const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const json = await res.json();
    if (!res.ok) { $("#err").textContent = json.error || "erro"; return; }
    token = json.token;
    sessionStorage.setItem("adminToken", token);
    load();
  };
}

// ---------- shell ----------

async function load() {
  try { data = await api("GET", "/stats"); } catch (err) { if (token) toast(err.message, true); return; }
  renderShell();
}

const TABS = [
  ["overview", "Visão geral", "chart-line"],
  ["users", "Usuários", "users"],
  ["lessons", "Lições", "book-open"],
  ["plans", "Planos", "credit-card"],
  ["payments", "Pagamentos", "receipt"],
  ["viral", "Viral", "fire"],
  ["settings", "Configurações", "gear"],
];

function renderShell() {
  mount(`
    <header class="admin-head">
      <div class="brand"><div data-mascot="28" data-mood="grumpy"></div> Mel <span class="muted">/ painel</span></div>
      <div class="admin-actions">
        <button class="pill" id="refresh">${icon("arrow-right", 14)} atualizar</button>
        <a class="pill" href="/" target="_blank">abrir o app</a>
        <button class="pill" id="logout">sair</button>
      </div>
    </header>
    <div class="admin-shell">
      <nav class="side-nav">${TABS.map(([id, label, ic]) => `<button class="side-btn ${tab === id ? "on" : ""}" data-tab="${id}">${icon(ic, 18)}<span>${label}</span></button>`).join("")}</nav>
      <main class="side-main" id="tabBody"></main>
    </div>`);
  $("#refresh").onclick = load;
  $("#logout").onclick = () => { sessionStorage.removeItem("adminToken"); token = null; showLogin(); };
  $$(".side-btn").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; sessionStorage.setItem("adminTab", tab); renderShell(); }));
  $(".side-btn.on")?.scrollIntoView({ inline: "center", block: "nearest" }); // nav horizontal no celular
  window.scrollTo(0, 0);
  ({ overview: renderOverview, users: renderUsers, lessons: renderLessons, plans: renderPlans, payments: renderPayments, viral: renderViral, settings: renderSettings })[tab]();
}

// ---------- visao geral ----------

function renderOverview() {
  const t = data.totals;
  const kpi = (label, value, note = "") => `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span>${note ? `<span class="kpi-note">${note}</span>` : ""}</div>`;
  $("#tabBody").innerHTML = `
    <section class="kpis">
      ${kpi("usuários", t.users, `+${t.usersToday} hoje · +${t.usersLast7d} em 7 dias`)}
      ${kpi("falando com a Mel agora", t.activeVoice, "sessões de voz abertas")}
      ${kpi("assinantes", t.subscribers, `com plano ativo · ${t.promoUsers} na promoção`)}
      ${kpi("prints pra aprovar", t.pendingMissions, `${t.bonusMinutesOutstanding} min de bônus em circulação`)}
      ${kpi("receita no mês", brl(t.revenueMonthCents), `${brl(t.revenueTotalCents)} no total`)}
      ${kpi("ativos em 7 dias", t.activeLast7d, "falaram com a Mel")}
      ${kpi("minutos de conversa", t.minutesTotal, `${t.minutesToday} hoje`)}
      ${kpi("sessões", t.sessionsTotal, `${t.sessionsToday} hoje`)}
      ${kpi("lições concluídas", t.lessonsDoneTotal)}
      ${kpi("custo estimado de IA", brl(t.estimatedCostBrl * 100), "≈ R$ 0,07 por minuto no tier pago")}
    </section>
    <section class="panel">
      <h2 class="title">Últimas sessões</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>quando</th><th>quem</th><th>lição</th><th>duração</th></tr></thead>
        <tbody>${data.recentSessions.map((s) => `<tr><td class="mono">${fmtDate(s.startedAt)}</td><td class="mono">${esc(s.email)}</td><td>${esc(s.lessonId)}</td><td>${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, "0")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">nenhuma sessão ainda</td></tr>`}</tbody>
      </table></div>
    </section>`;
}

// ---------- usuarios ----------

function renderUsers() {
  $("#tabBody").innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2 class="title">Usuários <span class="muted">(${data.users.length})</span></h2><input class="search" id="q" placeholder="buscar nome ou e-mail" /></div>
      <div class="tablewrap"><table id="usersTable">
        <thead><tr><th>nome</th><th>e-mail</th><th>plano</th><th>nível</th><th>tom</th><th>lições</th><th>min</th><th>último acesso</th><th></th></tr></thead>
        <tbody></tbody>
      </table></div>
    </section>`;
  const draw = (q = "") => {
    const rows = data.users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
    $("#usersTable tbody").innerHTML = rows.map((u) => `<tr class="${u.blocked ? "row-blocked" : ""}">
      <td>${esc(u.name) || "—"} ${u.role === "admin" ? `<span class="badge">admin</span>` : ""} ${u.blocked ? `<span class="badge red">bloqueado</span>` : ""}</td>
      <td class="mono">${esc(u.email)}</td>
      <td>${u.entitlement.free ? `<span class="muted">grátis</span>` : `${esc(u.entitlement.planName)} <span class="muted">até ${fmtDay(u.entitlement.expiresAt)}</span>`}</td>
      <td>${esc(STUDENT_LEVELS[u.profile.level] ?? "—")}</td><td>${esc(TONE_LABEL[u.profile.tone] ?? "—")}</td>
      <td>${u.lessonsDone}</td><td>${u.minutes}</td><td class="mono">${fmtDate(u.lastSeen)}</td>
      <td><button class="pill small" data-edit="${esc(u.email)}">editar</button></td></tr>`).join("") || `<tr><td colspan="9" class="muted">ninguém encontrado</td></tr>`;
    $$("[data-edit]").forEach((b) => (b.onclick = () => editUser(b.dataset.edit)));
  };
  draw();
  $("#q").oninput = (e) => draw(e.target.value);
}

function editUser(email) {
  const u = data.users.find((x) => x.email === email);
  const opt = (map, cur, empty = "—") => `<option value="">${empty}</option>` + Object.entries(map).map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("");
  modal(`
    <h2 class="title">${esc(u.name) || esc(u.email)}</h2>
    <p class="muted" style="margin:0 0 14px">${esc(u.email)} · cadastro ${fmtDate(u.createdAt)} · ${u.minutes} min falados</p>
    <form id="uform" class="form-grid">
      <div class="field"><label>Nome</label><input name="name" value="${esc(u.name)}" /></div>
      <div class="field"><label>Papel</label><select name="role"><option value="user" ${u.role !== "admin" ? "selected" : ""}>usuário</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option></select></div>
      <div class="field"><label>Nível</label><select name="level">${opt(STUDENT_LEVELS, u.profile.level)}</select></div>
      <div class="field"><label>Tom</label><select name="tone">${opt(TONE_LABEL, u.profile.tone)}</select></div>
      <div class="field"><label>O que trava</label><select name="blocker">${opt(BLOCKER_LABEL, u.profile.blocker)}</select></div>
      <div class="field"><label>Plano</label><select name="planId"><option value="">sem plano (grátis)</option>${data.plans.map((p) => `<option value="${p.id}" ${u.plan?.id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Plano expira em</label><input name="expiresAt" type="date" value="${dateInput(u.plan?.expiresAt)}" /></div>
      <div class="field"><label>Promoção de lançamento</label><select name="promoOn"><option value="" ${!u.promo ? "selected" : ""}>não tem</option><option value="1" ${u.promo ? "selected" : ""}>tem (${u.promo ? `até ${fmtDay(u.promo.expiresAt)}` : "dá a vaga agora"})</option></select></div>
      <div class="field"><label>Promoção expira em</label><input name="promoExpiresAt" type="date" value="${dateInput(u.promo?.expiresAt)}" /></div>
      <div class="field"><label>Minutos bônus <span class="muted">(indicações/missões)</span></label><input name="bonusMinutes" type="number" min="0" step="1" value="${u.bonusMinutes ?? 0}" /></div>
      <div class="field"><label>Indicação</label><input value="${u.refCode ? `código ${u.refCode}` : "—"}${u.referredBy ? ` · veio por ${u.referredBy}` : ""}" disabled /></div>
      <div class="field"><label>Nova senha <span class="muted">(opcional)</span></label><input name="password" type="text" placeholder="mínimo 6 caracteres" autocomplete="off" /></div>
      <label class="check"><input type="checkbox" name="blocked" ${u.blocked ? "checked" : ""} /> conta bloqueada (não consegue entrar nem falar com a Mel)</label>
      <div class="modal-actions">
        <button class="btn" type="submit">Salvar</button>
        <button class="btn btn-ghost" type="button" id="cancel">Cancelar</button>
        <button class="btn btn-danger" type="button" id="del">Excluir conta</button>
      </div>
      <p class="error" id="uerr"></p>
    </form>`);
  $("#cancel").onclick = closeModal;
  $("#del").onclick = async () => {
    if (!confirm(`Excluir ${u.email}? Apaga a conta e o progresso.`)) return;
    try { await api("DELETE", `/users/${encodeURIComponent(email)}`); closeModal(); toast("conta excluída"); load(); } catch (err) { $("#uerr").textContent = err.message; }
  };
  $("#uform").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const body = {
      name: f.name, role: f.role, blocked: Boolean(f.blocked),
      profile: { level: f.level, tone: f.tone, blocker: f.blocker },
      plan: f.planId ? { planId: f.planId, expiresAt: f.expiresAt ? `${f.expiresAt}T23:59:59.000Z` : undefined } : null,
      promo: f.promoOn ? { expiresAt: f.promoExpiresAt ? `${f.promoExpiresAt}T23:59:59.000Z` : undefined } : null,
      bonusMinutes: Number(f.bonusMinutes || 0),
    };
    try {
      await api("PUT", `/users/${encodeURIComponent(email)}`, body);
      if (f.password) await api("POST", `/users/${encodeURIComponent(email)}/password`, { password: f.password });
      closeModal(); toast("salvo"); load();
    } catch (err) { $("#uerr").textContent = err.message; }
  };
}

// ---------- licoes ----------

function renderLessons() {
  $("#tabBody").innerHTML = `
    <section class="panel">
      <h2 class="title">Gerar lição nova <span class="muted">com IA</span></h2>
      <p class="muted" style="margin:0 0 12px">A Mel escreve uma lição no formato das outras: foco, frases-alvo, roteiro de conversa e revisão. Você lê, ajusta se quiser e publica — só aí ela aparece pros alunos.</p>
      <form id="gen" class="gen-row">
        <select name="level">${LEVELS.map((l) => `<option value="${l}" ${l === "A2" ? "selected" : ""}>${l} · ${LEVEL_LABEL[l]}</option>`).join("")}</select>
        <input name="theme" placeholder="tema (opcional): ex. marcar consulta médica, viagem de avião…" />
        <button class="btn narrow" type="submit" id="genBtn">${icon("lightning", 16)} gerar lição</button>
      </form>
      <div id="preview"></div>
    </section>
    <section class="panel">
      <h2 class="title">Lições publicadas <span class="muted">(${data.lessons.length})</span></h2>
      <div class="tablewrap"><table>
        <thead><tr><th>#</th><th>lição</th><th>nível</th><th>sessões</th><th>concluídas</th><th>min</th><th>visível</th><th></th></tr></thead>
        <tbody>${data.lessons.map((l) => `<tr class="${l.active ? "" : "row-blocked"}">
          <td class="mono">${esc(l.id.slice(0, 2))}</td><td>${esc(l.title)}</td><td>${esc(l.level)} <span class="muted">${LEVEL_LABEL[l.level] ?? ""}</span></td>
          <td>${l.sessions}</td><td>${l.completions}</td><td>${l.minutes}</td>
          <td><button class="switch ${l.active ? "on" : ""}" data-toggle="${esc(l.id)}" aria-label="visível"></button></td>
          <td><button class="pill small" data-view="${esc(l.id)}">ver</button> <button class="pill small danger" data-del="${esc(l.id)}">excluir</button></td></tr>`).join("")}</tbody>
      </table></div>
    </section>`;
  $$("[data-toggle]").forEach((b) => (b.onclick = async () => {
    try { await api("PUT", `/lessons/${b.dataset.toggle}`, { active: !b.classList.contains("on") }); load(); } catch (err) { toast(err.message, true); }
  }));
  $$("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir essa lição de vez? (pra só esconder, use o botão de visível)")) return;
    try { await api("DELETE", `/lessons/${b.dataset.del}`); toast("lição excluída"); load(); } catch (err) { toast(err.message, true); }
  }));
  $$("[data-view]").forEach((b) => (b.onclick = async () => {
    try { const l = await api("GET", `/lessons/${b.dataset.view}`); modal(lessonHtml(l) + `<div class="modal-actions"><button class="btn btn-ghost" onclick="document.getElementById('modal').remove()">Fechar</button></div>`); } catch (err) { toast(err.message, true); }
  }));
  $("#gen").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const btn = $("#genBtn");
    btn.disabled = true; btn.textContent = "a Mel está escrevendo…";
    $("#preview").innerHTML = "";
    try {
      preview = await api("POST", "/lessons/generate", { level: f.level, theme: f.theme });
      $("#preview").innerHTML = `<div class="preview">${lessonHtml(preview)}
        <div class="modal-actions">
          <button class="btn narrow" id="publish">${icon("check", 16)} publicar</button>
          <button class="btn btn-ghost narrow" id="again">gerar outra</button>
          <button class="btn btn-ghost narrow" id="discard">descartar</button>
        </div></div>`;
      $("#publish").onclick = async () => {
        try { const saved = await api("POST", "/lessons", preview); toast(`publicada: ${saved.id}`); preview = null; load(); } catch (err) { toast(err.message, true); }
      };
      $("#again").onclick = () => $("#gen").requestSubmit();
      $("#discard").onclick = () => { preview = null; $("#preview").innerHTML = ""; };
    } catch (err) {
      $("#preview").innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false; btn.innerHTML = `${icon("lightning", 16)} gerar lição`;
    }
  };
}

function lessonHtml(l) {
  return `
    <p class="eyebrow" style="text-align:left;margin:0 0 4px">${esc(l.level)} · ${LEVEL_LABEL[l.level] ?? ""}${l.id ? ` · ${esc(l.id)}` : ""}</p>
    <h3 class="lesson-title">${esc(l.title)}</h3>
    <p class="muted">${esc(l.focus)}</p>
    <div class="lesson-block"><b>Aquecimento</b><p>${esc(l.warmup?.instruction)}</p>
      <ul>${(l.warmup?.examples ?? []).map((ex) => `<li><span class="en">${esc(ex.en)}</span> <span class="muted">— ${esc(ex.pt)}</span></li>`).join("")}</ul></div>
    <div class="lesson-block"><b>Conversa livre — ${esc(l.freeConversation?.topic)}</b><p>${esc(l.freeConversation?.instruction)}</p></div>
    <div class="lesson-block"><b>Revisão</b><ul>${(l.review?.checklist ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul><p>${esc(l.review?.closing)}</p></div>`;
}

// ---------- planos ----------

function renderPlans() {
  const row = (p, isNew = false) => `
    <form class="plan-row ${isNew ? "new" : ""}" data-plan="${esc(p.id)}">
      <div class="field"><label>Nome</label><input name="name" value="${esc(p.name)}" placeholder="ex: 10 min por dia" required /></div>
      <div class="field"><label>Min/dia</label><input name="minutesPerDay" type="number" min="1" value="${p.minutesPerDay}" /></div>
      <div class="field"><label>Preço (R$)</label><input name="price" type="number" min="0" step="0.01" value="${(p.priceCents / 100).toFixed(2)}" /></div>
      <div class="field"><label>Dias</label><input name="days" type="number" min="1" value="${p.days}" /></div>
      <div class="field wide"><label>Descrição</label><input name="description" value="${esc(p.description ?? "")}" /></div>
      <label class="check"><input type="checkbox" name="active" ${p.active ? "checked" : ""} /> à venda</label>
      <div class="plan-actions">
        <button class="btn narrow" type="submit">${isNew ? "criar plano" : "salvar"}</button>
        ${isNew ? "" : `<button class="pill small danger" type="button" data-delplan="${esc(p.id)}">excluir</button>`}
      </div>
    </form>`;
  $("#tabBody").innerHTML = `
    <section class="panel">
      <h2 class="title">Planos <span class="muted">(${data.plans.length})</span></h2>
      <p class="muted" style="margin:0 0 12px">O plano define quantos minutos por dia o aluno pode falar com a Mel. Quem não assinou tem a cota grátis do <code>FREE_MINUTES_PER_DAY</code>. Preço em reais; a cobrança é por Pix, pelo período em dias.</p>
      ${data.plans.map((p) => row(p)).join("")}
    </section>
    <section class="panel">
      <h2 class="title">Novo plano</h2>
      ${row({ id: "", name: "", minutesPerDay: 5, priceCents: 2990, days: 30, active: true, description: "" }, true)}
    </section>`;
  $$(".plan-row").forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      const body = { name: f.name, description: f.description, minutesPerDay: Number(f.minutesPerDay), priceCents: Math.round(Number(f.price) * 100), days: Number(f.days), active: Boolean(f.active) };
      try {
        if (form.classList.contains("new")) await api("POST", "/plans", body);
        else await api("PUT", `/plans/${form.dataset.plan}`, body);
        toast("plano salvo"); load();
      } catch (err) { toast(err.message, true); }
    };
  });
  $$("[data-delplan]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir esse plano? Quem já assinou continua até expirar.")) return;
    try { await api("DELETE", `/plans/${b.dataset.delplan}`); toast("plano excluído"); load(); } catch (err) { toast(err.message, true); }
  }));
}

// ---------- pagamentos ----------

function renderPayments() {
  const pix = data.pix;
  $("#tabBody").innerHTML = `
    <section class="panel">
      <h2 class="title">Pix (AbacatePay)</h2>
      <div class="status-grid">
        <div><span class="kpi-label">chave da API</span><b class="${pix.configured ? "ok" : "warn"}">${pix.configured ? "configurada" : "faltando"}</b></div>
        <div><span class="kpi-label">ambiente</span><b class="${pix.devMode === false ? "ok" : "warn"}">${pix.devMode === null ? "— (nenhum pix gerado ainda)" : pix.devMode ? "modo de teste (chave Dev)" : "produção"}</b></div>
        <div><span class="kpi-label">webhook</span><b class="${pix.webhook ? "ok" : "warn"}">${pix.webhook ? "segredo + PUBLIC_URL ok" : "sem webhook — o app confere por consulta a cada 4 s"}</b></div>
      </div>
      <p class="muted" style="margin-top:10px">${pix.configured ? "" : "Pra ligar: crie a chave em <b>abacatepay.com → Integração → Chaves de API</b> e cole em "}<button class="link" id="goSettings">Configurações → Pagamento</button>. Webhook (opcional, deixa a liberação instantânea): em <b>Integração → Webhooks</b>, URL <code>${esc(pix.webhookUrl)}</code>, evento <code>transparent.completed</code>, e o mesmo segredo nas Configurações.</p>
    </section>
    <section class="panel">
      <h2 class="title">Pedidos <span class="muted">(${data.orders.length})</span></h2>
      <div class="tablewrap"><table>
        <thead><tr><th>quando</th><th>quem</th><th>plano</th><th>valor</th><th>status</th><th>pago em</th></tr></thead>
        <tbody>${data.orders.map((o) => `<tr><td class="mono">${fmtDate(o.createdAt)}</td><td class="mono">${esc(o.email)}</td><td>${esc(o.planName)}</td><td>${brl(o.amountCents)}</td>
          <td><span class="badge ${o.status === "PAID" ? "green" : o.status === "WAITING" ? "" : "red"}">${esc(STATUS_LABEL[o.status] ?? o.status)}</span>${o.lastError ? ` <span class="muted" title="${esc(o.lastError)}">⚠</span>` : ""}</td>
          <td class="mono">${fmtDate(o.paidAt)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">nenhum pedido ainda</td></tr>`}</tbody>
      </table></div>
    </section>`;
  if ($("#goSettings")) $("#goSettings").onclick = () => { tab = "settings"; sessionStorage.setItem("adminTab", tab); renderShell(); };
}

// ---------- viral: promocao, indicacoes e missoes ----------

async function renderViral() {
  $("#tabBody").innerHTML = `<p class="muted">carregando…</p>`;
  let v;
  try { v = await api("GET", "/viral"); } catch (err) { toast(err.message, true); return; }
  const kpi = (label, value, note = "") => `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span>${note ? `<span class="kpi-note">${note}</span>` : ""}</div>`;
  const pending = v.missions.filter((m) => m.status === "pending");
  const reviewed = v.missions.filter((m) => m.status !== "pending");
  const STATUS = { approved: ["aprovado", "ok"], rejected: ["recusado", "red"] };
  const missionCard = (m) => `
    <div class="mission-card ${m.status}">
      <a href="/api/admin/missions/${m.id}/image?token=${encodeURIComponent(token)}" target="_blank"><img src="/api/admin/missions/${m.id}/image?token=${encodeURIComponent(token)}" alt="print" loading="lazy" /></a>
      <div class="mission-info">
        <b>${esc(m.rule)}</b> <span class="badge">+${m.reward} min</span>
        <div class="mono">${esc(m.userName || "")} · ${esc(m.email)}</div>
        <div class="muted">${fmtDate(m.createdAt)}${m.link ? ` · <a href="${esc(m.link)}" target="_blank" rel="noopener">abrir link</a>` : ""}</div>
        ${m.status === "pending"
          ? `<div class="mission-actions"><button class="pill small" data-approve="${m.id}">aprovar</button><button class="pill small danger" data-reject="${m.id}">recusar</button></div>`
          : `<div><span class="badge ${STATUS[m.status]?.[1] ?? ""}">${STATUS[m.status]?.[0] ?? m.status}</span> <span class="muted">${fmtDate(m.reviewedAt)}${m.note ? ` · ${esc(m.note)}` : ""}</span></div>`}
      </div>
    </div>`;
  $("#tabBody").innerHTML = `
    <section class="kpis">
      ${kpi("vagas da promoção", `${v.promo.used}/${v.promo.slots}`, v.promo.enabled ? `${v.promo.slotsLeft} restantes · ${v.promo.minutesPerDay} min/dia por ${v.promo.days} dias` : "promoção desligada")}
      ${kpi("indicados", v.referredTotal, `${v.creditedTotal} fizeram a primeira aula`)}
      ${kpi("prints pendentes", pending.length, "aprovar libera os minutos na hora")}
      ${kpi("prêmios", `${v.rewards.referrer}/${v.rewards.welcome}`, `min indica/indicado · story +${v.rewards.story} · post +${v.rewards.post}`)}
    </section>
    <section class="panel">
      <div class="panel-head"><h2 class="title">Prints pra aprovar <span class="muted">(${pending.length})</span></h2><button class="pill" id="toSettings">ajustar prêmios</button></div>
      <div class="mission-grid">${pending.map(missionCard).join("") || `<p class="muted">fila vazia</p>`}</div>
    </section>
    <section class="panel">
      <h2 class="title">Quem mais indica</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>quem</th><th>código</th><th>convidou</th><th>fizeram aula</th><th>bônus atual</th></tr></thead>
        <tbody>${v.referrers.map((r) => `<tr><td>${esc(r.name) || "—"}<div class="mono muted">${esc(r.email)}</div></td><td class="mono">${esc(r.refCode ?? "")}</td><td>${r.invited}</td><td>${r.credited}</td><td>${Math.round(r.bonusMinutes)} min</td></tr>`).join("") || `<tr><td colspan="5" class="muted">ninguém indicou ainda</td></tr>`}</tbody>
      </table></div>
    </section>
    <section class="panel">
      <h2 class="title">Já avaliados <span class="muted">(${reviewed.length})</span></h2>
      <div class="mission-grid">${reviewed.slice(0, 30).map(missionCard).join("") || `<p class="muted">nada ainda</p>`}</div>
    </section>`;
  $("#toSettings").onclick = () => { tab = "settings"; sessionStorage.setItem("adminTab", tab); renderShell(); };
  const review = async (id, action) => {
    const note = action === "reject" ? (prompt("Motivo (o aluno vê):") ?? "") : "";
    try { await api("POST", `/missions/${id}/review`, { action, note }); toast(action === "approve" ? "aprovado, minutos creditados" : "recusado"); renderViral(); }
    catch (err) { toast(err.message, true); }
  };
  $$("[data-approve]").forEach((b) => (b.onclick = () => review(b.dataset.approve, "approve")));
  $$("[data-reject]").forEach((b) => (b.onclick = () => review(b.dataset.reject, "reject")));
}

// ---------- configuracoes ----------

const GROUP_META = {
  ia: { title: "Inteligência artificial (Gemini)", icon: "sliders-horizontal", desc: "Chave e modelos usados na conversa por voz e na geração de lições." },
  acesso: { title: "Acesso ao painel", icon: "key", desc: "Quem consegue entrar em /admin." },
  limites: { title: "Limites de uso", icon: "chart-line", desc: "Quanto quem não paga pode conversar, e quantas conversas ao mesmo tempo o servidor aceita." },
  lancamento: { title: "Promoção de lançamento", icon: "fire", desc: "Os primeiros N cadastros ganham minutos grátis por um período. O app mostra as vagas restantes na tela inicial." },
  viral: { title: "Indique e ganhe / missões", icon: "users", desc: "Prêmios em minutos por indicação e por posts com print aprovado na aba Viral." },
  pagamento: { title: "Pagamento (Pix / AbacatePay)", icon: "credit-card", desc: "Chave da API e segredo do webhook pra gerar e confirmar cobranças por Pix." },
  seguranca: { title: "Segurança", icon: "shield-check", desc: "Segredo usado para assinar as sessões de login." },
};

function applyNewToken(newToken) {
  token = newToken;
  if (sessionStorage.getItem("adminToken")) sessionStorage.setItem("adminToken", newToken);
  else localStorage.setItem("token", JSON.stringify(newToken));
}

function fieldHtml(def) {
  const id = `f_${def.key}`;
  if (def.secret) {
    return `<div class="field">
      <label for="${id}">${esc(def.label)} ${def.hasValue ? `<span class="badge green">configurada</span>` : `<span class="badge red">não configurada</span>`}</label>
      <input id="${id}" name="${def.key}" type="password" autocomplete="off" placeholder="${def.hasValue ? `•••• ${esc(def.hint)} — deixe em branco pra manter` : "cole o valor aqui"}" />
      ${def.help ? `<small class="field-help">${esc(def.help)}</small>` : ""}
    </div>`;
  }
  if (def.type === "select") {
    return `<div class="field"><label for="${id}">${esc(def.label)}</label>
      <select id="${id}" name="${def.key}">${def.options.map((o) => `<option value="${esc(o)}" ${def.value === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
      ${def.help ? `<small class="field-help">${esc(def.help)}</small>` : ""}</div>`;
  }
  return `<div class="field"><label for="${id}">${esc(def.label)}</label>
    <input id="${id}" name="${def.key}" type="${def.type === "number" ? "number" : def.type === "url" ? "url" : "text"}" ${def.min !== undefined ? `min="${def.min}"` : ""} value="${esc(def.value)}" placeholder="${def.default ? esc(def.default) : ""}" />
    ${def.help ? `<small class="field-help">${esc(def.help)}</small>` : ""}</div>`;
}

async function renderSettings() {
  $("#tabBody").innerHTML = `<p class="small">carregando…</p>`;
  let payload;
  try { payload = await api("GET", "/settings"); } catch (err) { $("#tabBody").innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }

  const up = payload.system.uptimeSeconds;
  const uptime = up < 90 ? `${up}s` : up < 3600 ? `${Math.floor(up / 60)} min` : `${(up / 3600).toFixed(1)} h`;

  $("#tabBody").innerHTML = `
    ${Object.entries(payload.groups).map(([groupId, defs]) => {
      const meta = GROUP_META[groupId] ?? { title: groupId, icon: "gear", desc: "" };
      return `<section class="panel settings-panel">
        <div class="settings-head">${icon(meta.icon, 20)}<div><h2 class="title">${esc(meta.title)}</h2><p class="muted">${esc(meta.desc)}</p></div></div>
        <form class="settings-group" data-group="${groupId}">
          ${defs.map(fieldHtml).join("")}
          <div class="modal-actions"><button class="btn narrow" type="submit">salvar</button><span class="save-note" id="note_${groupId}"></span></div>
        </form>
      </section>`;
    }).join("")}
    <section class="panel">
      <div class="settings-head">${icon("chart-line", 20)}<div><h2 class="title">Sistema</h2><p class="muted">Informação, não editável aqui.</p></div></div>
      <div class="status-grid">
        <div><span class="kpi-label">porta</span><b>${esc(payload.system.port)}</b></div>
        <div><span class="kpi-label">node</span><b>${esc(payload.system.nodeVersion)}</b></div>
        <div><span class="kpi-label">no ar há</span><b>${uptime}</b></div>
        <div><span class="kpi-label">dados salvos em</span><b class="mono">${esc(payload.system.dataDir)}</b></div>
      </div>
    </section>`;

  $$(".settings-group").forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      const note = $(`#note_${form.dataset.group}`);
      note.textContent = "salvando…"; note.className = "save-note";
      try {
        const result = await api("PUT", "/settings", body);
        if (result.token) applyNewToken(result.token);
        note.textContent = result.changed.includes("JWT_SECRET") ? "salvo — sessão renovada" : "salvo";
        note.className = "save-note ok";
        toast("configurações salvas");
        $$(`.settings-group[data-group="${form.dataset.group}"] input[type=password]`).forEach((i) => (i.value = ""));
        setTimeout(() => renderSettings(), 400);
      } catch (err) {
        note.textContent = err.message; note.className = "save-note err";
      }
    };
  });
}

token ? load() : showLogin();
