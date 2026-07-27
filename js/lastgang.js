// Lastgang-CSV-Parser und Kennzahlenberechnung. Reine Funktionen, kein DOM-Zugriff
// (Ausnahme: FileReader, da CSV-Dateien nur so gelesen werden können).
// Logik übernommen aus der Referenzimplementierung lastgang-viewer.html,
// verifiziert gegen die Portalausgabe (siehe HANDOVER-lastgang-modul.md Abschnitt 4).

// "14.986,474" -> 14986.474 (Punkt = Tausender, Komma = Dezimal).
// NIE parseFloat() auf deutsche Zahlen anwenden — "14.986,474" würde zu 14.
export function deNum(s) {
  if (s == null) return NaN;
  const t = String(s)
    .replace(/[^\d,.\-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return t === "" ? NaN : parseFloat(t);
}

const splitRow = (line) => line.split(";").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));

// Beide Portaldateien sind Windows-1252 kodiert (Euro-Zeichen als Einzelbyte 0x80).
// ASCII ist in Windows-1252 enthalten, deshalb ist derselbe Decoder für beide Dateien korrekt.
// UTF-8 zerschießt das €-Zeichen in der Bepreisungsdatei.
export function readCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.onload = () => {
      try {
        resolve(new TextDecoder("windows-1252").decode(reader.result));
      } catch {
        resolve(new TextDecoder("utf-8").decode(reader.result));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Liest die Lastgang-CSV (Zeit;Wert) und erkennt die Einheit aus der Kopfzeile.
export function parseLastgang(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("Die Datei ist leer.");

  const head = splitRow(lines[0]);
  let headerUnit = null;
  const h = head.join(" ").toLowerCase();
  // Reihenfolge wichtig: "kwh" vor "kw" prüfen, sonst matcht "kw" zuerst in "kwh".
  // "kw" zusätzlich erkannt (echte Portal-Einheit, siehe robingut-bepreisung
  // portalEinheit()) und wie "kWh" behandelt — beides läuft durch denselben
  // Leistungs-Rechenzweig in computeStats (Division durch 1000/dt).
  if (/\bmw\b/.test(h)) headerUnit = "MW";
  else if (/kwh/.test(h) || /\bkw\b/.test(h)) headerUnit = "kWh";

  const startsWithData = /^\d{2}\.\d{2}\.\d{4}/.test(head[0] || "");
  const rows = [];
  for (let i = startsWithData ? 0 : 1; i < lines.length; i++) {
    const c = splitRow(lines[i]);
    if (c.length < 2) continue;
    const m = c[0].match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!m) continue;
    const v = deNum(c[1]);
    if (!isFinite(v)) continue;
    rows.push({ t: new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]), v });
  }
  if (rows.length < 2) {
    throw new Error(
      'Keine verwertbaren Zeilen gefunden. Erwartet wird z. B. "01.10.2026 00:00";"1,455".'
    );
  }
  rows.sort((a, b) => a.t - b.t);
  return { rows, headerUnit };
}

// Intervalllänge aus dem Median der Zeitabstände (robust gegen Zeitumstellung,
// anders als die erste Differenz).
export function intervalHours(rows) {
  const d = [];
  for (let i = 1; i < rows.length; i++) d.push((rows[i].t - rows[i - 1].t) / 3.6e6);
  d.sort((a, b) => a - b);
  const med = d[Math.floor(d.length / 2)];
  return med > 0 && med <= 24 ? med : 1;
}

// Berechnet alle Kennzahlen aus den Rohwerten. `unit` = "MW" | "kWh" (Nutzerwahl,
// kann von headerUnit abweichen — siehe Einheiten-Wächter in checkUnitMismatch).
export function computeStats(rows, unit) {
  const dt = intervalHours(rows);
  // Leistung in MW je Intervall. Bei kWh-Eingabe ist der Wert bereits Arbeit.
  const powMW = rows.map((r) => (unit === "MW" ? r.v : r.v / 1000 / dt));
  const energyMWh = powMW.reduce((s, p) => s + p * dt, 0);
  const pmax = Math.max(...powMW);
  const pmit = powMW.reduce((a, b) => a + b, 0) / powMW.length;
  // Hochtarif nach üblicher Definition: Mo–Fr 08:00–20:00.
  let ht = 0;
  rows.forEach((r, i) => {
    const wd = r.t.getDay();
    if (wd >= 1 && wd <= 5 && r.t.getHours() >= 8 && r.t.getHours() < 20) ht += powMW[i] * dt;
  });
  return {
    dt,
    powMW,
    energyMWh,
    pmax,
    pmit,
    vbh: pmax > 0 ? energyMWh / pmax : NaN,
    htPct: energyMWh > 0 ? (ht / energyMWh) * 100 : NaN,
    count: rows.length,
    from: rows[0].t,
    to: rows[rows.length - 1].t,
  };
}

// Plausibilitätsprüfung: Pmax >100 MW oder <0,001 MW ist fast sicher eine
// Einheitenverwechslung (Spec §5 Punkt 3).
export function pmaxPlausibel(pmax) {
  return pmax >= 0.001 && pmax <= 100;
}

// Einheiten-Wächter: erkannte Kopfzeilen-Einheit vs. tatsächlich gewählte Einheit.
// kWh statt MW ist Faktor 1000 im Ergebnis und fällt sonst niemandem auf.
export function checkUnitMismatch(headerUnit, selectedUnit) {
  return Boolean(headerUnit) && headerUnit !== selectedUnit;
}

// Liest die Bepreisungs-CSV aus dem Portal (Schlüssel-Wert-Format).
export function parseBepreisung(text) {
  const out = {};
  text.split(/\r?\n/).forEach((line) => {
    const c = splitRow(line);
    if (!c[0]) return;
    out[c[0]] = c;
  });
  const get = (k, i) => (out[k] ? out[k][i] : null);
  return {
    datei: get("Lastgang", 1),
    erstellt: get("Lastgang", 2),
    bepreisung: [get("Bepreisungszeitraum", 1), get("Bepreisungszeitraum", 3)],
    prognose: [get("Prognostizierter Zeitraum", 1), get("Prognostizierter Zeitraum", 2)],
    mengeMWh: deNum(get("Menge", 1)),
    kosten: deNum(get("Kosten", 1)),
    werte: deNum(get("Kosten", 3)),
    vbh: deNum(get("VBh", 1)),
    ht: deNum(get("HT", 1)),
    pmax: deNum(get("Pmax", 1)),
    pmittel: deNum(get("Pmittel", 1)),
    preisMWh: deNum(get("Fahrplanpreis", 1)),
    preisCt: deNum(get("Fahrplanpreis", 3)),
  };
}

// Abgleich Portal-Kennzahlen gegen eigene Berechnung, je Zeile mit Toleranz.
export function compareStats(portal, stats) {
  const rows = [
    ["Menge", portal.mengeMWh, stats.energyMWh, "MWh", 3, 0.01],
    ["Pmax", portal.pmax, stats.pmax, "MW", 3, 0.001],
    ["Pmittel", portal.pmittel, stats.pmit, "MW", 3, 0.001],
    ["VBh", portal.vbh, stats.vbh, "h", 0, 1],
    ["HT", portal.ht, stats.htPct, "%", 0, 1],
    ["Werte", portal.werte, stats.count, "", 0, 0],
  ];
  return rows.map(([label, a, b, unit, decimals, tol]) => ({
    label,
    portal: a,
    eigen: b,
    unit,
    decimals,
    match: isFinite(a) && isFinite(b) && Math.abs(a - b) <= tol,
  }));
}
