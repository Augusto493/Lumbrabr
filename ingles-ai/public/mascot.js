// Mel: esfera + anel de barras girando + rosto com humores. Implementacao propria.
window.Mascot = (function () {
  const BAR_COUNT = 44;
  const MOUTHS = {
    grumpy: "M38 70 Q50 63 62 70",
    neutral: "M39 68 L61 68",
    happy: "M37 64 Q50 78 63 64",
    talking: "M40 66 Q50 76 60 66",
    listening: "M42 68 Q50 65 58 68",
  };

  function seeded(i) {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  }

  function build(container, { size = 215, mood = "grumpy" } = {}) {
    container.classList.add("mascot");
    container.style.setProperty("--m-size", size + "px");
    container.innerHTML = "";

    const drift = el("div", "m-drift");
    const sway = el("div", "m-sway");
    const bob = el("div", "m-bob");
    const stage = el("div", "m-stage");
    const ring = el("div", "m-ring");
    const radius = size * 0.447;

    for (let i = 0; i < BAR_COUNT; i++) {
      const arm = el("div", "m-arm");
      arm.style.transform = `rotate(${(360 / BAR_COUNT) * i}deg)`;
      const bar = el("span", "m-bar");
      bar.style.height = `${(10 + seeded(i) * 18) * (size / 215)}px`;
      bar.style.opacity = (0.35 + seeded(i + 99) * 0.5).toFixed(2);
      bar.style.transform = `translateY(-${radius}px)`;
      arm.appendChild(bar);
      ring.appendChild(arm);
    }

    const halo = el("div", "m-halo");
    const orb = el("div", "m-orb");
    orb.innerHTML = `<svg class="m-face" viewBox="0 0 100 100" aria-hidden="true">
      <g class="m-brows"><path d="M27 37 L42 41"/><path d="M58 41 L73 37"/></g>
      <g class="m-eyes"><rect class="m-eye" x="32" y="42" width="7" height="12" rx="3.5"/><rect class="m-eye" x="61" y="42" width="7" height="12" rx="3.5"/></g>
      <path class="m-mouth" d="${MOUTHS.grumpy}"/>
    </svg>`;

    stage.append(ring, halo, orb);
    bob.appendChild(stage);
    sway.appendChild(bob);
    drift.appendChild(sway);
    container.appendChild(drift);
    setMood(container, mood);
    return container;
  }

  function setMood(container, mood) {
    if (!container) return;
    container.dataset.mood = mood;
    const m = container.querySelector(".m-mouth");
    if (m) m.setAttribute("d", MOUTHS[mood] || MOUTHS.neutral);
  }

  return { build, setMood };
})();
