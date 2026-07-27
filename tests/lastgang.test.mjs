import assert from "node:assert/strict";
import {
  deNum,
  parseLastgang,
  intervalHours,
  computeStats,
  pmaxPlausibel,
  checkUnitMismatch,
  parseBepreisung,
  compareStats,
} from "../js/lastgang.js";

function nahe(actual, expected, tolerance, label) {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${label}: erwartet ${expected}, erhalten ${actual} (Diff ${diff} > Toleranz ${tolerance})`
  );
}

// --- deNum: deutsche Zahlenformatierung (Handover §11 — NIE parseFloat) ---
{
  assert.equal(deNum("14.986,474"), 14986.474, "deNum: Tausenderpunkt + Dezimalkomma");
  assert.equal(deNum("1,455"), 1.455, "deNum: einfacher Dezimalwert");
  assert.equal(deNum("2.925"), 2925, "deNum: reiner Tausenderwert ohne Dezimalstelle");
  assert.equal(deNum("1.818.308,89"), 1818308.89, "deNum: mehrfacher Tausenderpunkt");
  assert.ok(Number.isNaN(deNum("")), "deNum: leerer String -> NaN");
  assert.ok(Number.isNaN(deNum(null)), "deNum: null -> NaN");
  assert.notEqual(deNum("14.986,474"), 14, "deNum: darf NICHT wie parseFloat auf 14 abschneiden");
}

// --- Kopfzeilen-Einheitserkennung ---
{
  const mw = parseLastgang('"Zeit";"Wert in MW"\n"01.10.2026 00:00";"1,455"\n"01.10.2026 01:00";"1,413"\n');
  assert.equal(mw.headerUnit, "MW", "Kopfzeile 'Wert in MW' erkannt");

  const kwh = parseLastgang('"Zeit";"Wert in kWh"\n"01.10.2026 00:00";"1455"\n"01.10.2026 01:00";"1413"\n');
  assert.equal(kwh.headerUnit, "kWh", "Kopfzeile 'Wert in kWh' erkannt");

  const unbekannt = parseLastgang('"Zeit";"Wert"\n"01.10.2026 00:00";"1,455"\n"01.10.2026 01:00";"1,413"\n');
  assert.equal(unbekannt.headerUnit, null, "Kopfzeile ohne Einheit -> null");

  const kw = parseLastgang('"Zeit";"Wert in kW"\n"01.10.2026 00:00";"1455"\n"01.10.2026 01:00";"1413"\n');
  assert.equal(kw.headerUnit, "kWh", "Kopfzeile 'Wert in kW' (echte Portal-Einheit) wie kWh behandelt");
}

// --- Datei ganz ohne Kopfzeile: nur Zeitstempel + Zahl, keine Titelzeile ---
// Viele echte Lastgang-Exporte haben keine Kopfzeile — der Parser muss die
// erste Zeile dann korrekt als Datenzeile erkennen (nicht als Kopfzeile
// überspringen) und headerUnit bleibt null (nichts zu erkennen).
{
  const ohneKopf = parseLastgang('"01.10.2026 00:00";"1,455"\n"01.10.2026 01:00";"1,413"\n"01.10.2026 02:00";"1,200"\n');
  assert.equal(ohneKopf.headerUnit, null, "Datei ohne Kopfzeile -> headerUnit null (nichts zu erkennen)");
  assert.equal(ohneKopf.rows.length, 3, "alle drei Datenzeilen erkannt, keine als Kopfzeile verworfen");
  assert.equal(ohneKopf.rows[0].v, 1.455, "erste Datenzeile korrekt geparst (nicht übersprungen)");
}

// --- Beispiel aus Handover §3.1 exakt nachgebildet ---
{
  const csv = '"Zeit";"Wert in MW"\n"01.10.2026 00:00";"1,455"\n"01.10.2026 01:00";"1,413"\n';
  const { rows, headerUnit } = parseLastgang(csv);
  assert.equal(headerUnit, "MW");
  assert.equal(rows.length, 2, "zwei Datenzeilen eingelesen");
  assert.equal(rows[0].v, 1.455, "erster Wert korrekt geparst");
  assert.equal(rows[1].v, 1.413, "zweiter Wert korrekt geparst");
  assert.equal(rows[0].t.getHours(), 0, "erste Zeitangabe 00:00");
  assert.equal(rows[1].t.getHours(), 1, "zweite Zeitangabe 01:00");
}

// --- 24 Stundenwerte à 1 MW: Menge 24 MWh, Pmax 1, VBh 24, count 24 ---
{
  const lines = ['"Zeit";"Wert in MW"'];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    lines.push(`"01.10.2026 ${hh}:00";"1,000"`);
  }
  const { rows } = parseLastgang(lines.join("\n"));
  nahe(intervalHours(rows), 1, 0.001, "Median-Intervall bei Stundenraster = 1h");

  const stats = computeStats(rows, "MW");
  nahe(stats.energyMWh, 24, 0.001, "24x 1 MW über 1h -> 24 MWh");
  nahe(stats.pmax, 1, 0.001, "Pmax = 1 MW");
  nahe(stats.pmit, 1, 0.001, "Pmittel = 1 MW");
  nahe(stats.vbh, 24, 0.001, "VBh = Menge/Pmax = 24");
  assert.equal(stats.count, 24, "24 Werte gezählt");
}

// --- kWh-Modus liefert bei äquivalenten Werten identische Kennzahlen wie MW ---
{
  const lines = ['"Zeit";"Wert in kWh"'];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    lines.push(`"01.10.2026 ${hh}:00";"1000"`);
  }
  const { rows, headerUnit } = parseLastgang(lines.join("\n"));
  assert.equal(headerUnit, "kWh");
  const stats = computeStats(rows, "kWh");
  nahe(stats.energyMWh, 24, 0.001, "kWh-Modus: 24x 1000 kWh bei dt=1h -> 24 MWh (identisch zu MW-Fall)");
  nahe(stats.pmax, 1, 0.001, "kWh-Modus: Pmax = 1 MW äquivalent");
}

// --- HT-Anteil: konstruierte Woche mit bekanntem Soll ---
// Mo 01.06.2026 00:00 Uhr, 168 Stundenwerte à 1 MW über eine volle Woche.
// HT = Mo-Fr 08:00-19:59 Uhr = 5 Tage x 12 Stunden = 60 Werte von 168.
{
  const start = new Date(2026, 5, 1, 0, 0); // Montag 01.06.2026
  assert.equal(start.getDay(), 1, "Testvoraussetzung: 01.06.2026 ist ein Montag");
  const lines = ['"Zeit";"Wert in MW"'];
  for (let h = 0; h < 168; h++) {
    const d = new Date(start.getTime() + h * 3.6e6);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    lines.push(`"${dd}.${mm}.${d.getFullYear()} ${hh}:00";"1,000"`);
  }
  const { rows } = parseLastgang(lines.join("\n"));
  const stats = computeStats(rows, "MW");
  const htSoll = (60 / 168) * 100;
  nahe(stats.htPct, htSoll, 0.5, "HT-Anteil einer Woche mit konstanter Last = 60/168 der Zeit");
}

// --- Median-Robustheit: eine fehlende Stunde (z.B. Zeitumstellung) kippt dt nicht ---
{
  const lines = ['"Zeit";"Wert in MW"'];
  for (let h = 0; h < 24; h++) {
    if (h === 12) continue; // eine Stunde fehlt (Sprung von 2h an dieser Stelle)
    const hh = String(h).padStart(2, "0");
    lines.push(`"01.10.2026 ${hh}:00";"1,000"`);
  }
  const { rows } = parseLastgang(lines.join("\n"));
  nahe(intervalHours(rows), 1, 0.001, "Median bleibt bei 1h trotz einer fehlenden Stunde (Ausreißer wird nicht Median)");
}

// --- Plausibilitätsprüfung (Handover §5 Punkt 3) ---
{
  assert.equal(pmaxPlausibel(2.925), true, "2,925 MW ist plausibel");
  assert.equal(pmaxPlausibel(150), false, "150 MW (>100) ist unplausibel -> Einheitenverwechslung");
  assert.equal(pmaxPlausibel(0.0001), false, "0,0001 MW (<0,001) ist unplausibel");
  assert.equal(pmaxPlausibel(0.001), true, "Grenzwert 0,001 MW gilt noch als plausibel");
  assert.equal(pmaxPlausibel(100), true, "Grenzwert 100 MW gilt noch als plausibel");
}

// --- Einheiten-Wächter ---
{
  assert.equal(checkUnitMismatch("MW", "kWh"), true, "Kopfzeile MW, aber kWh gewählt -> Warnung");
  assert.equal(checkUnitMismatch("MW", "MW"), false, "Kopfzeile und Auswahl stimmen ueberein -> keine Warnung");
  assert.equal(checkUnitMismatch(null, "MW"), false, "keine Kopfzeilen-Einheit -> keine Warnung moeglich");
}

// --- Fehlerfaelle: leere Datei / Textmuell -> verstaendliche Exception, kein Absturz ---
{
  assert.throws(() => parseLastgang(""), /leer/i, "leere Datei wirft verstaendlichen Fehler");
  assert.throws(
    () => parseLastgang("dies ist keine CSV\nsondern nur Text\n"),
    /keine verwertbaren zeilen/i,
    "Textmuell ohne Datumsmuster wirft verstaendlichen Fehler"
  );
}

// --- parseBepreisung: Beispielblock aus Handover §3.2 ---
{
  const csv = [
    '"Lastgang";"2026-07-27_19_49-LastgangImport.csv";"27.07.26 20:34";"Uhr";',
    '"Prognostizierter Zeitraum";"01.10.27";"31.12.29";;',
    '"Bepreisungszeitraum";"01.10.26 00:00";"Uhr";"30.09.27 23:00";"Uhr"',
    '"Menge";"14.986,474";"MWh";"14.986.474";"kWh"',
    '"";;;;',
    '"Kosten";"1.818.308,89";"";"8.760";"Werte"',
    '"VBh";"5.124";"h";;',
    '"HT";"38";"%";;',
    '"Pmax";"2,925";"MW";"2.925";"kW"',
    '"Pmittel";"1,711";"MW";"1.711";"kW"',
    '"Fahrplanpreis";"121,33";"€/MWh";"12,133";"Ct/kWh"',
  ].join("\r\n");

  const p = parseBepreisung(csv);
  assert.equal(p.datei, "2026-07-27_19_49-LastgangImport.csv", "Dateiname korrekt extrahiert");
  nahe(p.mengeMWh, 14986.474, 0.001, "Menge exakt wie im Handover-Beispiel");
  nahe(p.kosten, 1818308.89, 0.01, "Kosten exakt wie im Handover-Beispiel");
  assert.equal(p.werte, 8760, "Anzahl Werte 8.760");
  assert.equal(p.vbh, 5124, "VBh 5.124");
  assert.equal(p.ht, 38, "HT 38 %");
  nahe(p.pmax, 2.925, 0.001, "Pmax 2,925 MW");
  nahe(p.pmittel, 1.711, 0.001, "Pmittel 1,711 MW");
  nahe(p.preisMWh, 121.33, 0.01, "Fahrplanpreis 121,33 €/MWh");
  nahe(p.preisCt, 12.133, 0.001, "Fahrplanpreis 12,133 Ct/kWh");
}

// --- compareStats: Toleranzen greifen korrekt ---
{
  const portal = { mengeMWh: 100, pmax: 5, pmittel: 3, vbh: 20, ht: 40, werte: 8760 };
  const stats = { energyMWh: 100.005, pmax: 5.0005, pmit: 3.5, vbh: 20, htPct: 40, count: 8760 };
  const result = compareStats(portal, stats);

  const menge = result.find((r) => r.label === "Menge");
  assert.equal(menge.match, true, "Menge innerhalb Toleranz 0.01 -> match");

  const pmittel = result.find((r) => r.label === "Pmittel");
  assert.equal(pmittel.match, false, "Pmittel 3 vs 3.5 ausserhalb Toleranz 0.001 -> kein match");

  const werte = result.find((r) => r.label === "Werte");
  assert.equal(werte.match, true, "Werte exakt gleich -> match");
}

console.log("Alle Lastgang-Tests erfolgreich.");
