// UI-Bindung für das Lastgang-Modul: Drag&Drop, Canvas-Kurve, Kennzahlen-Rendering.
// Importiert ausschließlich aus lastgang.js — keine zweite Parser-/Formel-Implementierung.
// Rührt den bestehenden Rechenweg (js/app.js / js/engine.js) nicht an: setzt nur das
// vorhandene #verbrauch-Feld und ruft den übergebenen onVerbrauchChange-Callback.

import {
  readCsvFile,
  parseLastgang,
  computeStats,
  pmaxPlausibel,
  checkUnitMismatch,
  parseBepreisung,
  compareStats,
} from "./lastgang.js";

const $ = (id) => document.getElementById(id);
const nf = (v, d = 3) =>
  v == null || !isFinite(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const nf0 = (v) => nf(v, 0);

const dtf = (d) =>
  d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function initLastgangUI({ onVerbrauchChange }) {
  const state = {
    rows: null,
    headerUnit: null,
    unit: "MW",
    stats: null,
    portal: null,
    fromLastgang: false,
    cols: [],
  };

  const drop = $("lgDrop");
  const fileInput = $("lgFile");
  const dropCalc = $("lgDropCalc");
  const fileCalcInput = $("lgFileCalc");
  const canvas = $("lgChart");
  const readout = $("lgReadout");

  function setUnit(u) {
    // state.unit bleibt "MW" | "kWh" — exakt die Werte, die computeStats() erwartet
    // (kWh = Energiemenge je Zeile, wird durch die Intervalllänge geteilt). Der
    // Button-data-unit ist "kW" (passt zur echten Portal-Einheit bei
    // robingut-bepreisung), hier auf "kWh" zurücknormiert.
    state.unit = u === "kW" ? "kWh" : u;
    document.querySelectorAll("#lgUnitSeg button").forEach((b) => {
      const btnUnit = b.dataset.unit === "kW" ? "kWh" : b.dataset.unit;
      b.classList.toggle("on", btnUnit === state.unit);
    });
  }

  function renderStats() {
    const s = state.stats;
    const cells = [
      ["Menge", nf(s.energyMWh, 3), "MWh", nf0(s.energyMWh * 1000) + " kWh"],
      ["Pmax", nf(s.pmax, 3), "MW", nf0(s.pmax * 1000) + " kW"],
      ["Pmittel", nf(s.pmit, 3), "MW", nf0(s.pmit * 1000) + " kW"],
      ["VBh", nf0(s.vbh), "h", "Benutzungsstunden"],
      ["HT-Anteil", nf(s.htPct, 0), "%", "Mo–Fr 08–20 Uhr"],
      ["Werte", nf0(s.count), "", s.dt * 60 + "-Minuten-Raster"],
    ];
    $("lgStats").innerHTML =
      cells
        .map(
          (c) =>
            `<div class="lg-cell"><dt>${c[0]}</dt><dd>${c[1]}${c[2] ? `<em>${c[2]}</em>` : ""}</dd>` +
            `<div class="alt">${c[3]}</div></div>`
        )
        .join("") +
      `<div class="lg-cell"><dt>Zeitraum</dt><dd style="font-size:14px">${dtf(s.from)}</dd>` +
      `<div class="alt">bis ${dtf(s.to)}</div></div>`;
  }

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const pad = { t: 16, r: 12, b: 20, l: 50 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const p = state.stats.powMW;
    const max = state.stats.pmax * 1.08 || 1;
    const y = (v) => pad.t + ih - (v / max) * ih;

    g.strokeStyle = "#dbe6d6";
    g.lineWidth = 1;
    g.fillStyle = "#5f6f61";
    g.font = "11px system-ui,sans-serif";
    g.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const val = (max * i) / 4;
      const yy = Math.round(y(val)) + 0.5;
      g.beginPath();
      g.moveTo(pad.l, yy);
      g.lineTo(w - pad.r, yy);
      g.stroke();
      g.fillText(nf(val, 1), pad.l - 8, yy + 4);
    }

    // Bei 8.760 Werten pro Pixelspalte Min/Max zeichnen, nicht jeden Punkt —
    // sonst verschwindet die Lastspitze zwischen den Pixeln (Handover §6.2).
    state.cols = [];
    const n = p.length;
    g.strokeStyle = "#0e670e";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < iw; x++) {
      const a = Math.floor((x / iw) * n);
      const b = Math.max(a + 1, Math.floor(((x + 1) / iw) * n));
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a; i < b && i < n; i++) {
        if (p[i] < lo) lo = p[i];
        if (p[i] > hi) hi = p[i];
      }
      if (!isFinite(lo)) continue;
      state.cols.push({ x: pad.l + x, i: a, lo, hi });
      g.moveTo(pad.l + x + 0.5, y(hi));
      g.lineTo(pad.l + x + 0.5, y(lo) + 0.6);
    }
    g.stroke();

    // Pmax-Marke
    const ym = Math.round(y(state.stats.pmax)) + 0.5;
    g.strokeStyle = "#a33a1e";
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(pad.l, ym);
    g.lineTo(w - pad.r, ym);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "#a33a1e";
    g.textAlign = "left";
    g.fillText("Pmax " + nf(state.stats.pmax, 3) + " MW", pad.l + 6, ym - 5);

    g.fillStyle = "#5f6f61";
    g.textAlign = "left";
    g.fillText(dtf(state.stats.from).slice(0, 8), pad.l, h - 4);
    g.textAlign = "right";
    g.fillText(dtf(state.stats.to).slice(0, 8), w - pad.r, h - 4);
  }

  canvas.addEventListener("mousemove", (e) => {
    if (!state.cols.length) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best = state.cols[0];
    let bd = Infinity;
    for (const c of state.cols) {
      const d = Math.abs(c.x - x);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const pt = state.rows[best.i];
    readout.innerHTML = dtf(pt.t) + " &nbsp; <b>" + nf(state.stats.powMW[best.i], 3) + " MW</b>";
  });
  canvas.addEventListener("mouseleave", () => {
    readout.textContent = "Zeiger über die Kurve bewegen";
  });

  function checkUnit() {
    const detected = $("lgDetected");
    detected.textContent = state.headerUnit
      ? "In der Kopfzeile steht: " + state.headerUnit
      : "Keine Einheit in der Kopfzeile gefunden — es gilt Ihre Auswahl oben";

    const unitBox = $("lgUnitAlarm");
    if (checkUnitMismatch(state.headerUnit, state.unit)) {
      unitBox.innerHTML =
        "<b>Einheit passt nicht zur Datei.</b> Die Kopfzeile nennt " +
        state.headerUnit +
        ", ausgewählt ist " +
        state.unit +
        ". Das ist ein Faktor 1000 im Ergebnis. Bitte prüfen, bevor weitergerechnet wird.";
      unitBox.classList.remove("hide");
    } else {
      unitBox.classList.add("hide");
    }

    const plausBox = $("lgPlausibelAlarm");
    if (!pmaxPlausibel(state.stats.pmax)) {
      plausBox.innerHTML =
        "<b>Ungewöhnliche Lastspitze.</b> Pmax = " +
        nf(state.stats.pmax, 3) +
        " MW liegt außerhalb des plausiblen Bereichs (0,001–100 MW) — das deutet auf eine Einheitenverwechslung hin.";
      plausBox.classList.remove("hide");
    } else {
      plausBox.classList.add("hide");
    }
  }

  function compare() {
    if (!state.portal || !state.stats) return;
    const rows = compareStats(state.portal, state.stats);
    $("lgCompare").innerHTML =
      "<tr><th>Kennzahl</th><th>Portal</th><th>Eigene Berechnung</th><th>Einheit</th><th></th></tr>" +
      rows
        .map(
          (r) =>
            `<tr><td>${r.label}</td><td class="num">${nf(r.portal, r.decimals)}</td>` +
            `<td class="num">${nf(r.eigen, r.decimals)}</td><td>${r.unit}</td>` +
            `<td class="${r.match ? "lg-match" : "lg-mismatch"}">${r.match ? "stimmt überein" : "weicht ab"}</td></tr>`
        )
        .join("");
  }

  function renderPrice() {
    const p = state.portal;
    $("lgPriceCard").innerHTML =
      `<div><div class="lbl">Fahrplanpreis</div><div class="big">${nf(p.preisMWh, 2)}</div>` +
      `<div class="alt">€/MWh &nbsp;·&nbsp; ${nf(p.preisCt, 3)} Ct/kWh</div></div>` +
      `<div><div class="lbl">Kosten gesamt</div><div class="med">${nf(p.kosten, 2)} €</div>` +
      `<div class="alt">${nf(p.mengeMWh, 3)} MWh</div></div>` +
      `<div><div class="lbl">Bepreisungszeitraum</div><div class="med" style="font-size:15px">${p.bepreisung[0] || "–"}</div>` +
      `<div class="alt">bis ${p.bepreisung[1] || "–"}</div></div>`;
    $("lgPriceBlock").classList.remove("hide");
  }

  // `uebernehmen`: true nur beim tatsächlichen Datei-Upload. Beim reinen Umschalten
  // der Einheit (z. B. um die Faktor-1000-Warnung zu kontrollieren) wird NUR die
  // Anzeige aktualisiert — das Verbrauchsfeld ändert sich währenddessen nicht, sonst
  // sähe der Nutzer kurzzeitig eine falsche, aber plausible Zahl (Handover §5).
  function refresh(uebernehmen) {
    if (!state.rows) return;
    state.stats = computeStats(state.rows, state.unit);
    renderStats();
    // Sichtbar machen VOR dem Zeichnen: solange #lgResult noch "hide" trägt
    // (display:none), hat der Canvas clientWidth/clientHeight = 0 und
    // drawChart() zeichnet ins Leere — die Kurve blieb bis zum nächsten
    // Refresh (z.B. Einheiten-Klick) unsichtbar.
    $("lgResult").classList.remove("hide");
    drawChart();
    checkUnit();
    compare();

    if (uebernehmen && onVerbrauchChange) onVerbrauchChange(state.stats.energyMWh * 1000);
  }

  function showError(msg) {
    const box = $("lgError");
    box.textContent = msg;
    box.classList.remove("hide");
    $("lgResult").classList.add("hide");
  }

  function wire(dropEl, inputEl, handler) {
    const load = async (file) => {
      if (!file) return;
      $("lgError").classList.add("hide");
      try {
        const text = await readCsvFile(file);
        handler(text);
        dropEl.classList.add("filled");
        dropEl.innerHTML =
          `<strong>${file.name}</strong><span>${Math.round(file.size / 1024)} KB gelesen — klicken, um eine andere Datei zu wählen</span>`;
      } catch (err) {
        dropEl.classList.add("filled");
        dropEl.innerHTML = `<strong style="color:#a33a1e">${err.message}</strong><span>Andere Datei wählen</span>`;
        showError(err.message);
      }
    };
    dropEl.addEventListener("click", () => inputEl.click());
    dropEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inputEl.click();
      }
    });
    inputEl.addEventListener("change", (e) => load(e.target.files[0]));
    ["dragenter", "dragover"].forEach((ev) =>
      dropEl.addEventListener(ev, (e) => {
        e.preventDefault();
        dropEl.classList.add("over");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dropEl.addEventListener(ev, (e) => {
        e.preventDefault();
        dropEl.classList.remove("over");
      })
    );
    dropEl.addEventListener("drop", (e) => load(e.dataTransfer.files[0]));
  }

  wire(drop, fileInput, (text) => {
    const { rows, headerUnit } = parseLastgang(text);
    state.rows = rows;
    state.headerUnit = headerUnit;
    state.fromLastgang = true;
    // Die vor dem Upload gewählte Einheit bleibt maßgeblich (viele Dateien
    // haben keine Kopfzeile — dann gibt es nichts zum automatisch Erkennen).
    // Widerspricht die Kopfzeile der Auswahl, warnt checkUnit() in refresh().
    refresh(true);
  });

  wire(dropCalc, fileCalcInput, (text) => {
    state.portal = parseBepreisung(text);
    renderPrice();
    compare();
  });

  document.querySelectorAll("#lgUnitSeg button").forEach((b) => {
    b.addEventListener("click", () => {
      setUnit(b.dataset.unit);
      refresh(false);
    });
  });

  window.addEventListener("resize", () => {
    if (state.stats) drawChart();
  });

  return {
    isFromLastgang: () => state.fromLastgang,
    clearLastgangLink: () => {
      state.fromLastgang = false;
    },
  };
}
