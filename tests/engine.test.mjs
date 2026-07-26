import assert from "node:assert/strict";
import {
  netto,
  verbraucherPreisCt,
  jahreskosten,
  ersparnis,
  mehrerloespotential,
  vermarktungsform,
  grundpreisEinspeiser,
  nettoMehrerloes,
  regime,
  berechneVerbraucher,
  berechneErzeuger,
} from "../js/engine.js";

function nahe(actual, expected, tolerance, label) {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${label}: erwartet ${expected}, erhalten ${actual} (Diff ${diff} > Toleranz ${tolerance})`
  );
}

// Spec §3: Viersen-Referenz — m=50%, F=17,56, eCommunity=9,46, eReststrom=13,09 -> 28,83 ct/kWh
{
  const preisCt = verbraucherPreisCt({ m: 50, F: 17.56, eCommunity: 9.46, eReststrom: 13.09 });
  nahe(preisCt, 28.83, 0.01, "Spec §3 Viersen-Referenzpreis");
}

// Spec §6: (9,50 - 5,00) ct * 99.000 kWh = 4.455 €/a
{
  const potential = mehrerloespotential({ eCommunity: 9.5, istVerguetung: 5.0, menge: 99000 });
  nahe(potential, 4455.0, 0.01, "Spec §6 Mehrerlöspotential (illustrativ)");
}

// Spec §6: Netto-Mehrerlös nach Grundpreis = 4.455 - 1,90*12 = 4.432,20 €/a (EEG-Festvergütung, <=100 kWp)
{
  const vermarktung = vermarktungsform({ kWp: 99, freiwilligDV: false });
  assert.equal(vermarktung, "eeg", "Spec §6 Vermarktungsform <=100 kWp ohne freiwillige DV");
  const grundpreisMonat = grundpreisEinspeiser({ vermarktung, eegGrundpreisMonat: 1.9 });
  assert.equal(grundpreisMonat, 1.9, "Spec §6 EEG-Grundpreis fix 1,90 €/Monat");
  const nettoP = nettoMehrerloes({ mehrerloes: 4455.0, grundpreisMonat });
  nahe(nettoP, 4432.2, 0.01, "Spec §6 Netto-Mehrerlös nach Grundpreis");
}

// Spec §6: >100 kWp Peak -> immer Direktvermarktung -> individuelles Angebot (kein Grundpreis-Abzug)
{
  const vermarktung = vermarktungsform({ kWp: 150, freiwilligDV: false });
  assert.equal(vermarktung, "direktvermarktung", "Spec §6 >100 kWp Peak zwingt Direktvermarktung");
  const grundpreisMonat = grundpreisEinspeiser({ vermarktung, eegGrundpreisMonat: 1.9 });
  assert.equal(grundpreisMonat, null, "Spec §6 Direktvermarktung -> individuelles Angebot, kein Grundpreis-Fixwert");
}

// Spec §6: freiwillige Direktvermarktung <=100 kWp
{
  const vermarktung = vermarktungsform({ kWp: 50, freiwilligDV: true });
  assert.equal(vermarktung, "direktvermarktung", "Spec §6 freiwillige DV auch <=100 kWp");
}

// Spec §11 Regime B Worst Case: E_Reststrom=11, m=30% -> 0,30*9,5 + 0,70*11 = 10,55 ct/kWh -> 52.750 €/a bei 500.000 kWh
{
  const preisCt = verbraucherPreisCt({ m: 30, F: 0, eCommunity: 9.5, eReststrom: 11 });
  nahe(preisCt, 10.55, 0.01, "Spec §11 Regime B Worst Case ct/kWh");
  const kosten = jahreskosten({ preisCt, verbrauchKwh: 500000, grundpreisMonat: 0 });
  nahe(kosten.gesamt, 52750, 1, "Spec §11 Regime B Worst Case €/a");
}

// Spec §11 Regime B Best Case: E_Reststrom=9, m=70% -> 0,70*9,5 + 0,30*9,0 = 9,35 ct/kWh -> ~46.750 €/a
{
  const preisCt = verbraucherPreisCt({ m: 70, F: 0, eCommunity: 9.5, eReststrom: 9.0 });
  nahe(preisCt, 9.35, 0.01, "Spec §11 Regime B Best Case ct/kWh");
  const kosten = jahreskosten({ preisCt, verbrauchKwh: 500000, grundpreisMonat: 0 });
  nahe(kosten.gesamt, 46750, 50, "Spec §11 Regime B Best Case €/a (Spec rundet auf ~)");
}

// WSE-API-Referenz (0.1): Viersen 41749, 15.000 kWh, Grundpreis 19,70 €/Monat brutto
// F=17,55964, E_Reststrom=13,09 -> Energiepreis 30,64964 ct/kWh (reiner Reststrombezug, m=0)
{
  const preisCt = verbraucherPreisCt({ m: 0, F: 17.55964, eCommunity: 9.46, eReststrom: 13.09 });
  nahe(preisCt, 30.64964, 0.001, "API-Referenz reiner Reststrompreis Viersen");
  const kosten = jahreskosten({ preisCt, verbrauchKwh: 15000, grundpreisMonat: 19.7 });
  nahe(kosten.energieAnteil, 4597.446, 1, "API-Referenz Energiekosten/Jahr Viersen 15.000 kWh");
  nahe(kosten.grundpreisJahr, 236.4, 0.01, "API-Referenz Grundpreis/Jahr Viersen");
}

// Netto-Umrechnung: Netto = Brutto / 1,19 (API-bestätigt, z.B. 30,64964 -> 25,756)
{
  nahe(netto(30.64964), 25.756, 0.01, "Brutto->Netto Umrechnung ÷1,19");
}

// Regime-Weiche §2/§4/§5
{
  assert.equal(regime(15000), "A", "Regime A unter 100.000 kWh");
  assert.equal(regime(100000), "A", "Regime A bei exakt 100.000 kWh (Grenze zählt noch zu A)");
  assert.equal(regime(100001), "B", "Regime B über 100.000 kWh");
}

// Komplettberechnung Verbraucher (Integrationstest der Spec-§3-Referenz inkl. Ersparnis)
{
  const result = berechneVerbraucher({
    m: 50,
    F: 17.56,
    eCommunity: 9.46,
    eReststrom: 13.09,
    verbrauchKwh: 15000,
    grundpreisMonat: 19.7,
    istPreisCt: 35,
  });
  nahe(result.preisCt, 28.83, 0.01, "Integrationstest Verbraucher preisCt");
  nahe(result.ersparnis, 924.9, 1, "Integrationstest Verbraucher Ersparnis ((35-28.83)/100*15000)");
}

// Komplettberechnung Erzeuger (Integrationstest der Spec-§6-Referenz)
{
  const result = berechneErzeuger({
    eCommunity: 9.5,
    istVerguetung: 5.0,
    menge: 99000,
    kWp: 99,
    freiwilligDV: false,
    eegGrundpreisMonat: 1.9,
  });
  nahe(result.potential, 4455.0, 0.01, "Integrationstest Erzeuger Mehrerlöspotential");
  assert.equal(result.vermarktung, "eeg", "Integrationstest Erzeuger Vermarktungsform");
  nahe(result.nettoMehrerloes, 4432.2, 0.01, "Integrationstest Erzeuger Netto-Mehrerlös");
}

console.log("Alle Engine-Tests erfolgreich.");
