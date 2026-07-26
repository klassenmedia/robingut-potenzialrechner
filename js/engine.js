// Reine Rechenlogik gemäß Spezifikation §3–§7. Kein DOM-Zugriff, keine Rundung hier
// (Rundung erfolgt ausschließlich bei der Anzeige in app.js).

const VAT_RATE = 0.19;

// Brutto -> Netto (Spec: vereinfachte USt-Umrechnung ÷1,19)
export function netto(brutto) {
  return brutto / (1 + VAT_RATE);
}

// §3: Verbraucherpreis [ct/kWh] = m*(F+E_Community) + (1-m)*(F+E_Reststrom)
export function verbraucherPreisCt({ m, F, eCommunity, eReststrom }) {
  const anteil = m / 100;
  return anteil * (F + eCommunity) + (1 - anteil) * (F + eReststrom);
}

// §3: Jahreskosten [€] = Verbraucherpreis * Jahresverbrauch + Grundpreis*12
export function jahreskosten({ preisCt, verbrauchKwh, grundpreisMonat }) {
  const energieAnteil = (preisCt / 100) * verbrauchKwh;
  const grundpreisJahr = grundpreisMonat * 12;
  return {
    energieAnteil,
    grundpreisJahr,
    gesamt: energieAnteil + grundpreisJahr,
  };
}

// §3: Ersparnis vs. Ist-Tarif
export function ersparnis({ istPreisCt, preisCt, verbrauchKwh }) {
  return ((istPreisCt - preisCt) / 100) * verbrauchKwh;
}

// §6: Mehrerlöspotential (brutto) [€/a] = (E_Community - Ist_Verguetung) * angebotene_Menge
export function mehrerloespotential({ eCommunity, istVerguetung, menge }) {
  return ((eCommunity - istVerguetung) / 100) * menge;
}

// §6: Vermarktungsform — kWp > 100 ODER freiwillige Direktvermarktung -> Direktvermarktung
export function vermarktungsform({ kWp, freiwilligDV }) {
  return kWp > 100 || freiwilligDV ? "direktvermarktung" : "eeg";
}

// §6: Grundpreis Einspeiser (EEG-Festvergütung = fix; Direktvermarktung = individuelles Angebot)
export function grundpreisEinspeiser({ vermarktung, eegGrundpreisMonat }) {
  if (vermarktung === "direktvermarktung") {
    return null; // "Individuelles Angebot erforderlich"
  }
  return eegGrundpreisMonat;
}

// §6: Netto-Mehrerlös nach Grundpreis (nur wenn EEG-Festvergütung; bei DV kein Grundpreis-Abzug möglich)
export function nettoMehrerloes({ mehrerloes, grundpreisMonat }) {
  if (grundpreisMonat == null) return mehrerloes;
  return mehrerloes - grundpreisMonat * 12;
}

// §7: Regime-Weiche (< bzw. > 100.000 kWh)
export function regime(verbrauchKwh) {
  return verbrauchKwh > 100000 ? "B" : "A";
}

// Komplettberechnung Verbraucher-Zweig für einen gegebenen Zustand.
export function berechneVerbraucher({
  m,
  F,
  eCommunity,
  eReststrom,
  verbrauchKwh,
  grundpreisMonat,
  istPreisCt,
}) {
  const preisCt = verbraucherPreisCt({ m, F, eCommunity, eReststrom });
  const kosten = jahreskosten({ preisCt, verbrauchKwh, grundpreisMonat });
  const save = ersparnis({ istPreisCt, preisCt, verbrauchKwh });
  return { preisCt, ...kosten, ersparnis: save };
}

// Komplettberechnung Erzeuger-Zweig für einen gegebenen Zustand.
export function berechneErzeuger({
  eCommunity,
  istVerguetung,
  menge,
  kWp,
  freiwilligDV,
  eegGrundpreisMonat,
}) {
  const potential = mehrerloespotential({ eCommunity, istVerguetung, menge });
  const vermarktung = vermarktungsform({ kWp, freiwilligDV });
  const grundpreisMonat = grundpreisEinspeiser({ vermarktung, eegGrundpreisMonat });
  const nettoP = nettoMehrerloes({ mehrerloes: potential, grundpreisMonat });
  return { potential, vermarktung, grundpreisMonat, nettoMehrerloes: nettoP };
}
