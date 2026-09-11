const files = [...document.querySelectorAll(".file")];
const tabsEl = document.querySelector("#tabs-row");
const sections = [...document.querySelectorAll(".section")];
const openTabs = [];
const TAB_ICONS = ["tri", "circ", "cross", "sq"];

function meta(id) {
  return files.find((f) => f.dataset.id === id);
}

function openSection(id, addTab = true) {
  sections.forEach((s) => s.classList.toggle("active", s.dataset.id === id));
  files.forEach((f) => f.classList.toggle("active", f.dataset.id === id));
  if (addTab && !openTabs.includes(id)) openTabs.push(id);
  renderTabs(id);
  const active = sections.find((s) => s.dataset.id === id);
  if (active) active.closest(".content").scrollTop = 0;
}

function closeTab(id, ev) {
  ev.stopPropagation();
  const i = openTabs.indexOf(id);
  if (i < 0) return;
  openTabs.splice(i, 1);
  const current = sections.find((s) => s.classList.contains("active"))?.dataset.id;
  if (current === id) {
    const next = openTabs[i - 1] || openTabs[i] || openTabs[0];
    if (next) openSection(next, false);
    else {
      renderTabs(null);
      sections.forEach((s) => s.classList.remove("active"));
      files.forEach((f) => f.classList.remove("active"));
    }
  } else {
    renderTabs(current);
  }
}

function renderTabs(activeId) {
  tabsEl.innerHTML = "";
  openTabs.forEach((id) => {
    const file = meta(id);
    const btn = document.createElement("button");
    btn.className = "tab" + (id === activeId ? " active" : "");
    btn.title = file?.dataset.file || id;
    const glyph = TAB_ICONS[openTabs.indexOf(id) % TAB_ICONS.length];
    btn.innerHTML = `<i class="tab-ico ${glyph}"></i><span>${file?.dataset.short || id}</span>`;
    btn.onclick = () => openSection(id, false);
    const x = document.createElement("button");
    x.className = "x";
    x.type = "button";
    x.setAttribute("aria-label", "Cerrar");
    x.textContent = "×";
    x.onclick = (e) => closeTab(id, e);
    btn.appendChild(x);
    tabsEl.appendChild(btn);
  });
}

files.forEach((f) => f.addEventListener("click", () => openSection(f.dataset.id)));

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea, button.scen")) return;
  const ids = files.map((f) => f.dataset.id);
  const current = sections.find((s) => s.classList.contains("active"))?.dataset.id;
  const i = ids.indexOf(current);
  if (e.key === "ArrowDown" || e.key === "ArrowRight") openSection(ids[Math.min(ids.length - 1, i + 1)]);
  if (e.key === "ArrowUp" || e.key === "ArrowLeft") openSection(ids[Math.max(0, i - 1)]);
});

openSection("00", true);

function numberCodeBlocks() {
  document.querySelectorAll(".code[data-code]").forEach((block) => {
    const pre = block.querySelector("pre");
    const lines = pre.innerHTML.replace(/\n$/, "").split("\n");
    const wrap = document.createElement("div");
    wrap.innerHTML = lines
      .map((line, i) => `<div class="code-line"><span class="ln">${i + 1}</span><span class="src">${line || "&nbsp;"}</span></div>`)
      .join("");
    block.innerHTML = "";
    block.appendChild(wrap);
  });
}
numberCodeBlocks();

const SCENARIOS = {
  base: {
    n_total: 10, n_required: 8, n_technicians: 2, mtbf: 2000, mttr: 8,
    t_prev: 720, beta: 1.8, replications: 24, use_weibull: "1",
  },
  sobreprev: {
    n_total: 10, n_required: 8, n_technicians: 2, mtbf: 2000, mttr: 8,
    t_prev: 480, beta: 1.8, replications: 24, use_weibull: "1",
  },
  viejo: {
    n_total: 10, n_required: 8, n_technicians: 2, mtbf: 700, mttr: 10,
    t_prev: 720, beta: 2.4, replications: 24, use_weibull: "1",
  },
  saturado: {
    n_total: 10, n_required: 8, n_technicians: 1, mtbf: 1200, mttr: 16,
    t_prev: 1080, beta: 1.8, replications: 24, use_weibull: "1",
  },
  lento: {
    n_total: 8, n_required: 7, n_technicians: 2, mtbf: 1500, mttr: 36,
    t_prev: 1440, beta: 1.6, replications: 24, use_weibull: "1",
  },
};

const form = document.querySelector("#sim-form");
const runBtn = document.querySelector("#run");
const statusEl = document.querySelector("#sim-status");
const charts = {};

function applyScenario(key) {
  const s = SCENARIOS[key];
  if (!s) return;
  Object.entries(s).forEach(([name, value]) => {
    const el = form.elements[name];
    if (el) el.value = value;
  });
  document.querySelectorAll(".scen").forEach((b) => b.classList.toggle("active", b.dataset.scen === key));
}

document.querySelectorAll(".scen").forEach((btn) => {
  btn.addEventListener("click", () => applyScenario(btn.dataset.scen));
});
applyScenario("base");

function pct(x) {
  return (Number(x) * 100).toFixed(2) + "%";
}
function money(x) {
  return "$" + Math.round(Number(x)).toLocaleString("es-CO");
}
function hours(x) {
  return Number(x).toFixed(1) + " h";
}
function nice(n, digits = 2) {
  return Number(Number(n).toFixed(digits));
}

function setKpi(id, value, sub, win) {
  const el = document.querySelector(id);
  el.querySelector(".val").textContent = value;
  el.querySelector(".sub").textContent = sub || "";
  el.classList.toggle("win", win === true);
  el.classList.toggle("lose", win === false);
}

function axisLabel(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + "k";
  return Number(n.toFixed(2)).toString();
}

function barChart(id, series, yMin, yMax) {
  const el = document.querySelector(id);
  if (!el || typeof echarts === "undefined") return;
  if (charts[id]) {
    charts[id].dispose();
    delete charts[id];
  }
  const chart = echarts.init(el, null, { renderer: "svg", width: el.clientWidth || 240, height: 128 });
  chart.setOption({
    animation: false,
    grid: { left: 36, right: 8, top: 18, bottom: 22 },
    legend: {
      show: series.length > 1,
      top: 0,
      textStyle: { color: "#8b93ab", fontSize: 10 },
      itemWidth: 8,
      itemHeight: 8,
    },
    tooltip: { trigger: "axis", valueFormatter: (v) => axisLabel(v) },
    xAxis: {
      type: "category",
      data: ["Correctiva", "Preventiva"],
      axisLabel: { color: "#8b93ab", fontSize: 10 },
      axisLine: { lineStyle: { color: "#2a3142" } },
    },
    yAxis: {
      type: "value",
      min: yMin,
      max: yMax,
      splitNumber: 3,
      axisLabel: { color: "#8b93ab", fontSize: 10, formatter: axisLabel },
      splitLine: { lineStyle: { color: "#232838" } },
    },
    series: series.map((s) => ({
      type: "bar",
      name: s.name,
      data: s.data.map((v, i) => ({
        value: nice(v, 2),
        itemStyle: {
          color: series.length === 1 ? (i === 0 ? "#f07178" : "#c3e88d") : s.color,
          borderRadius: [4, 4, 0, 0],
        },
      })),
      barMaxWidth: 28,
    })),
  });
  charts[id] = chart;
}

function buildConclusions(out) {
  const c = out.correctiva.means;
  const p = out.preventiva.means;
  const sla = out.params.sla;
  const winnerA = out.winner;
  const cheaper = p.cost < c.cost ? "preventiva" : "correctiva";
  const items = [];

  items.push(
    winnerA === "preventiva"
      ? `La preventiva sostiene más el servicio: ${pct(p.availability)} frente a ${pct(c.availability)}.`
      : `La correctiva deja más tiempo el clúster arriba: ${pct(c.availability)} frente a ${pct(p.availability)}. La preventiva está parando de más.`
  );

  if (c.availability >= sla && p.availability >= sla) {
    items.push("Las dos políticas cumplen el SLA de 99.90%. El desempate es costo y cola de técnicos.");
  } else if (c.availability >= sla && p.availability < sla) {
    items.push("Solo la correctiva cumple el 99.90%. En este escenario la agenda preventiva recorta disponibilidad.");
  } else if (p.availability >= sla && c.availability < sla) {
    items.push("Solo la preventiva cumple el 99.90%. Sin paradas programadas el desgaste tumba el SLA.");
  } else {
    items.push("Ninguna llega al 99.90%. Faltan técnicos, redundancia o un MTTR más corto; no es un debate de política sola.");
  }

  items.push(
    cheaper === "preventiva"
      ? `La preventiva sale más barata al año (${money(p.cost)} vs ${money(c.cost)}): evita horas de caída caras.`
      : `La correctiva es más barata (${money(c.cost)} vs ${money(p.cost)}). Prevenir tanto no se paga con el SLA ganado.`
  );

  if (p.failures + 0.5 < c.failures) {
    items.push(`La preventiva corta fallas: ${nice(p.failures, 1)} vs ${nice(c.failures, 1)} eventos/año. El envejecimiento Weibull se interrumpe.`);
  } else {
    items.push("La preventiva no baja las fallas lo suficiente: el intervalo T_prev o β no compensan las paradas.");
  }

  if (p.tech_utilization > 0.75 || c.tech_utilization > 0.75 || p.avg_queue > 0.4) {
    items.push("El taller es el cuello de botella (alta ocupación o cola). Contratar técnicos mueve más el KPI que retocar ν.");
  } else if (out.params.k_redundant <= 1 && Math.min(c.availability, p.availability) < sla) {
    items.push(`Redundancia justa (k = ${out.params.k_redundant}). Un nodo extra suele ser más barato que un año de multa SLA.`);
  } else {
    items.push(`Recomendación: operar con política ${winnerA} en este escenario y revisar GIGO (calibrar λ y μ en campo).`);
  }

  return items;
}

async function runSim(ev) {
  ev.preventDefault();
  runBtn.disabled = true;
  statusEl.textContent = "corriendo réplicas…";
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    n_total: +data.n_total,
    n_required: +data.n_required,
    n_technicians: +data.n_technicians,
    mtbf: +data.mtbf,
    mttr: +data.mttr,
    t_prev: +data.t_prev,
    beta: +data.beta,
    replications: +data.replications,
    use_weibull: data.use_weibull === "1",
  };
  try {
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    renderResults(await res.json());
  } catch (err) {
    statusEl.textContent = "error: " + err.message;
  } finally {
    runBtn.disabled = false;
  }
}

function renderResults(out) {
  const c = out.correctiva.means;
  const p = out.preventiva.means;
  setKpi("#kpi-a-c", pct(c.availability), `SLA en ${(c.sla_ok * 100).toFixed(0)}% de réplicas`, c.availability >= out.params.sla);
  setKpi("#kpi-a-p", pct(p.availability), `SLA en ${(p.sla_ok * 100).toFixed(0)}% de réplicas`, p.availability >= out.params.sla);
  setKpi("#kpi-cost", money(Math.min(c.cost, p.cost)), "política más barata", true);
  setKpi("#kpi-win", out.winner, `Δ A ${nice(out.delta_availability * 100, 2)} pp`, out.winner === "preventiva");

  document.querySelector("#eq-live").textContent =
    `λ=${nice(out.params.lambda, 5)}   μ=${nice(out.params.mu, 4)}   ν=${nice(out.params.nu, 5)}   A individual=${pct(out.params.A_individual)}   N+k=${out.params.n_required}+${out.params.k_redundant}`;

  const pink = "#f07178";
  const green = "#c3e88d";

  barChart("#chart-avail", [{ name: "A %", data: [c.availability * 100, p.availability * 100], color: pink }], 95, 100);
  barChart("#chart-cost", [{ name: "Costo", data: [c.cost, p.cost], color: green }]);
  barChart("#chart-down", [{ name: "Horas", data: [c.downtime_hours, p.downtime_hours], color: pink }]);
  barChart("#chart-events", [
    { name: "Fallas", data: [c.failures, p.failures], color: pink },
    { name: "Preventivas", data: [c.preventive, p.preventive], color: "#82aaff" },
  ]);
  barChart("#chart-sla", [{ name: "SLA %", data: [c.sla_ok * 100, p.sla_ok * 100], color: green }], 0, 100);
  barChart("#chart-tech", [{ name: "Uso %", data: [c.tech_utilization * 100, p.tech_utilization * 100], color: "#82aaff" }], 0, 100);

  const list = document.querySelector("#conclusions");
  list.innerHTML = buildConclusions(out).map((t) => `<li>${t}</li>`).join("");
  statusEl.textContent = `listo · ${out.correctiva.replications} réplicas · ganador ${out.winner}`;
}

form.addEventListener("submit", runSim);

window.addEventListener("resize", () => {
  Object.values(charts).forEach((ch) => {
    const el = ch.getDom();
    if (!el) return;
    ch.resize({ width: el.clientWidth || 240, height: 128 });
  });
});
