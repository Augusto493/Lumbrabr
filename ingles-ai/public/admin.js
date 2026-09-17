const app = document.getElementById("app");
const $ = (sel, root = document) => root.querySelector(sel);
// usa a sessao do app se o usuario logado for admin; senao cai na senha do painel
function appToken() {
  try { return JSON.parse(localStorage.getItem("token")); } catch { return null; }
}
let token = sessionStorage.getItem("adminToken") || appToken();

const LEVEL_LABEL = { A0: "iniciante", A1: "iniciante", A2: "básico", B1: "intermediário", B2: "avançado", C1: "avançado" };
const TONE_LABEL = { braba: "braba", deboa: "de boa" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mount(html) {
  app.innerHTML = html;
  document.querySelectorAll("[data-mascot]").forEach((el) => Mascot.build(el, { size: Number(el.dataset.mascot), mood: el.dataset.mood || "grumpy" }));
}

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
    const data = await res.json();
    if (!res.ok) { $("#err").textContent = data.error || "erro"; return; }
    token = data.token;
    sessionStorage.setItem("adminToken", token);
    loadDashboard();
  };
}

async function loadDashboard() {
  const res = await fetch("/api/admin/stats", { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const hadAdminToken = Boolean(sessionStorage.getItem("adminToken"));
    sessionStorage.removeItem("adminToken");
    token = null;
    return showLogin(hadAdminToken ? "sessão expirada" : "");
  }
  const d = await res.json();
  const t = d.totals;

  const kpi = (label, value, note = "") => `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span>${note ? `<span class="kpi-note">${note}</span>` : ""}</div>`;

  mount(`
    <header class="admin-head">
      <div class="brand"><div data-mascot="28" data-mood="grumpy"></div> Mel <span class="muted">/ painel</span></div>
      <div class="admin-actions">
        <button class="pill" id="refresh">${icon("arrow-right", 14)} atualizar</button>
        <a class="pill" href="/" target="_blank">abrir o app</a>
        <button class="pill" id="logout">sair</button>
      </div>
    </header>

    <section class="kpis">
      ${kpi("usuários", t.users, `+${t.usersToday} hoje · +${t.usersLast7d} em 7 dias`)}
      ${kpi("ativos em 7 dias", t.activeLast7d, "falaram com a Mel")}
      ${kpi("minutos de conversa", t.minutesTotal, `${t.minutesToday} hoje`)}
      ${kpi("sessões", t.sessionsTotal, `${t.sessionsToday} hoje`)}
      ${kpi("lições concluídas", t.lessonsDoneTotal)}
      ${kpi("custo estimado de IA", `R$ ${t.estimatedCostBrl.toFixed(2).replace(".", ",")}`, "≈ R$ 0,07 por minuto no tier pago")}
    </section>

    <section class="panel">
      <h2 class="title">Usuários <span class="muted">(${d.users.length})</span></h2>
      <div class="tablewrap"><table>
        <thead><tr><th>nome</th><th>e-mail</th><th>cadastro</th><th>nível</th><th>tom</th><th>trava</th><th>lições</th><th>min</th><th>último acesso</th></tr></thead>
        <tbody>${d.users.map((u) => `<tr>
          <td>${esc(u.name) || "—"}</td><td class="mono">${esc(u.email)}</td><td class="mono">${fmtDate(u.createdAt)}</td>
          <td>${esc(u.profile.level ?? "—")}</td><td>${esc(TONE_LABEL[u.profile.tone] ?? "—")}</td><td>${esc(u.profile.blocker ?? "—")}</td>
          <td>${u.lessonsDone}</td><td>${u.minutes}</td><td class="mono">${fmtDate(u.lastSeen)}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">ninguém ainda</td></tr>`}</tbody>
      </table></div>
    </section>

    <section class="panel">
      <h2 class="title">Lições</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>#</th><th>lição</th><th>nível</th><th>sessões</th><th>concluídas</th><th>min</th></tr></thead>
        <tbody>${d.lessons.map((l, i) => `<tr><td class="mono">${String(i).padStart(2, "0")}</td><td>${esc(l.title)}</td><td>${esc(l.level)} <span class="muted">${LEVEL_LABEL[l.level] ?? ""}</span></td><td>${l.sessions}</td><td>${l.completions}</td><td>${l.minutes}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>

    <section class="panel">
      <h2 class="title">Últimas sessões</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>quando</th><th>quem</th><th>lição</th><th>duração</th></tr></thead>
        <tbody>${d.recentSessions.map((s) => `<tr><td class="mono">${fmtDate(s.startedAt)}</td><td class="mono">${esc(s.email)}</td><td>${esc(s.lessonId)}</td><td>${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, "0")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">nenhuma sessão ainda</td></tr>`}</tbody>
      </table></div>
    </section>`);

  $("#refresh").onclick = loadDashboard;
  $("#logout").onclick = () => { sessionStorage.removeItem("adminToken"); token = null; showLogin(); };
}

token ? loadDashboard() : showLogin();
