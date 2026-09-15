const state = {
  token: localStorage.getItem("token") || null,
  name: localStorage.getItem("name") || "",
  lessons: [],
  currentLesson: null,
  ws: null,
  audioCtx: null,
  micStream: null,
  processorNode: null,
  playbackCtx: null,
  nextPlaybackTime: 0,
  recording: false,
};

const el = (id) => document.getElementById(id);

// ---------- auth ----------

el("tabLogin").onclick = () => switchTab("login");
el("tabRegister").onclick = () => switchTab("register");

function switchTab(which) {
  el("tabLogin").classList.toggle("active", which === "login");
  el("tabRegister").classList.toggle("active", which === "register");
  el("loginForm").classList.toggle("hidden", which !== "login");
  el("registerForm").classList.toggle("hidden", which !== "register");
}

el("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await authRequest("/api/auth/login", fd, "loginError");
};

el("registerForm").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await authRequest("/api/auth/register", fd, "registerError");
};

async function authRequest(url, formData, errorElId) {
  const body = Object.fromEntries(formData.entries());
  el(errorElId).textContent = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "erro desconhecido");
    state.token = data.token;
    state.name = data.name || data.email;
    localStorage.setItem("token", state.token);
    localStorage.setItem("name", state.name);
    showLessons();
  } catch (err) {
    el(errorElId).textContent = err.message;
  }
}

el("logoutBtn").onclick = () => {
  localStorage.clear();
  state.token = null;
  location.reload();
};

// ---------- lessons ----------

async function showLessons() {
  el("authView").classList.add("hidden");
  el("conversationView").classList.add("hidden");
  el("lessonsView").classList.remove("hidden");
  el("userBadge").classList.remove("hidden");
  el("userName").textContent = state.name;

  const res = await fetch("/api/lessons", { headers: authHeaders() });
  if (res.status === 401) return logoutForced();
  state.lessons = await res.json();

  el("lessonList").innerHTML = "";
  for (const lesson of state.lessons) {
    const card = document.createElement("div");
    card.className = "lesson-card";
    card.innerHTML = `
      <h3>${lesson.title}</h3>
      <p>${lesson.focus}</p>
      ${lesson.completed ? '<span class="done">✓ concluida</span>' : ""}
    `;
    card.onclick = () => openLesson(lesson.id);
    el("lessonList").appendChild(card);
  }
}

function authHeaders() {
  return { Authorization: `Bearer ${state.token}` };
}

function logoutForced() {
  localStorage.clear();
  location.reload();
}

el("backBtn").onclick = () => {
  stopVoiceSession();
  showLessons();
};

// ---------- conversation / voice ----------

async function openLesson(lessonId) {
  const res = await fetch(`/api/lessons/${lessonId}`, { headers: authHeaders() });
  state.currentLesson = await res.json();

  el("lessonsView").classList.add("hidden");
  el("conversationView").classList.remove("hidden");
  el("lessonTitle").textContent = state.currentLesson.title;
  el("transcript").innerHTML = "";
  el("status").textContent = "conectando...";

  connectVoiceSession(lessonId);
}

function connectVoiceSession(lessonId) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/voice?token=${state.token}&lessonId=${lessonId}`);
  state.ws = ws;

  ws.onopen = () => (el("status").textContent = "conectado, aguardando IA...");

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "ready") {
      el("status").textContent = "pronto — aperte o microfone e fale";
    } else if (msg.type === "audio") {
      playAudioChunk(msg.data);
    } else if (msg.type === "transcript") {
      addTranscriptLine(msg.role, msg.text);
    } else if (msg.type === "error") {
      el("status").textContent = `erro: ${msg.message}`;
    }
  };

  ws.onclose = () => (el("status").textContent = "desconectado");
}

function addTranscriptLine(role, text) {
  const div = document.createElement("div");
  div.className = `line ${role}`;
  div.textContent = text;
  el("transcript").appendChild(div);
  el("transcript").scrollTop = el("transcript").scrollHeight;
}

el("micBtn").onclick = async () => {
  if (state.recording) {
    stopRecording();
  } else {
    await startRecording();
  }
};

el("endLessonBtn").onclick = () => {
  state.ws?.send(JSON.stringify({ type: "lessonDone" }));
  stopVoiceSession();
  showLessons();
};

function stopVoiceSession() {
  stopRecording();
  state.ws?.close();
  state.ws = null;
}

// captura o microfone, faz downsample para 16kHz mono PCM16 e envia via WebSocket
async function startRecording() {
  state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.audioCtx = new AudioContext();
  const source = state.audioCtx.createMediaStreamSource(state.micStream);

  const bufferSize = 4096;
  state.processorNode = state.audioCtx.createScriptProcessor(bufferSize, 1, 1);

  state.processorNode.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const pcm16 = downsampleTo16kHz(input, state.audioCtx.sampleRate);
    const base64 = int16ToBase64(pcm16);
    state.ws?.send(JSON.stringify({ type: "audio", data: base64 }));
  };

  source.connect(state.processorNode);
  state.processorNode.connect(state.audioCtx.destination);

  state.recording = true;
  el("micBtn").textContent = "🔴 Gravando (toque para parar)";
  el("micBtn").classList.add("active");
  el("mascot")?.classList.add("listening");
}

function stopRecording() {
  state.processorNode?.disconnect();
  state.audioCtx?.close();
  state.micStream?.getTracks().forEach((t) => t.stop());
  state.ws?.send(JSON.stringify({ type: "audioStreamEnd" }));

  state.recording = false;
  el("micBtn").textContent = "🎙️ Falar";
  el("micBtn").classList.remove("active");
  el("mascot")?.classList.remove("listening");
}

function downsampleTo16kHz(float32Input, inputSampleRate) {
  const targetRate = 16000;
  if (inputSampleRate === targetRate) return floatTo16Bit(float32Input);

  const ratio = inputSampleRate / targetRate;
  const outLength = Math.round(float32Input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, float32Input.length - 1);
    const frac = srcIndex - i0;
    output[i] = float32Input[i0] * (1 - frac) + float32Input[i1] * frac;
  }
  return floatTo16Bit(output);
}

function floatTo16Bit(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function int16ToBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ---------- playback do audio que a IA devolve (PCM16, 24kHz) ----------

function playAudioChunk(base64Data) {
  if (!state.playbackCtx) {
    state.playbackCtx = new AudioContext({ sampleRate: 24000 });
    state.nextPlaybackTime = state.playbackCtx.currentTime;
  }

  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);

  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

  const buffer = state.playbackCtx.createBuffer(1, float32.length, 24000);
  buffer.copyToChannel(float32, 0);

  const src = state.playbackCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(state.playbackCtx.destination);

  const startAt = Math.max(state.nextPlaybackTime, state.playbackCtx.currentTime);
  src.start(startAt);
  state.nextPlaybackTime = startAt + buffer.duration;
}

// ---------- bootstrap ----------

if (state.token) {
  showLessons();
}
