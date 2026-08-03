import { berechneVerbraucher, berechneErzeuger, netto, regime } from "./engine.js";
import { initLastgangUI } from "./lastgang-ui.js";

const $ = (id) => document.getElementById(id);
const val = (id) => {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
};
const de = (n, d = 2) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (n) => de(n) + " €";
const ct = (n) => de(n) + " ct";

const S = { rolle: "verbraucher", rf: "privat", preistabelle: null, lastgang: null };

async function ladePreistabelle() {
  try {
    const res = await fetch("data/preise.json");
    S.preistabelle = await res.json();
  } catch {
    S.preistabelle = {};
  }
}

function plzLookup() {
  const plz = $("plz").value.trim();
  const statusEl = $("plzStatus");
  const eintrag = S.preistabelle ? S.preistabelle[plz] : null;

  if (eintrag) {
    $("F").value = eintrag.fBrutto;
    $("eReststrom").value = eintrag.eReststromBrutto;
    const staffel = eintrag.grundpreisStaffel;
    const verbrauch = val("verbrauch");
    let grundpreis = staffel[0][1];
    for (const [stufe, preis] of staffel) {
      if (verbrauch >= stufe && preis != null) grundpreis = preis;
    }
    $("grundpreis").value = grundpreis;
    statusEl.textContent = `✓ ${eintrag.stadt} — regionale Netzentgelte geladen`;
    statusEl.className = "plz-status ok";
  } else {
    statusEl.textContent = "Keine Regionaldaten für diese PLZ — Referenzwerte (Viersen) eingetragen, bitte prüfen.";
    statusEl.className = "plz-status fallback";
  }
}

let setzeVerbrauchProgrammatisch = false;

function markiereAlsAbgeleitet(verbrauchKwh) {
  setzeVerbrauchProgrammatisch = true;
  $("verbrauch").value = Math.round(verbrauchKwh);
  setzeVerbrauchProgrammatisch = false;
  $("verbrauchAbgeleitetTag").classList.remove("hide");
  $("lastgangReset").classList.remove("hide");
  calc();
}

function loeseLastgangVerknuepfung() {
  $("verbrauchAbgeleitetTag").classList.add("hide");
  $("lastgangReset").classList.add("hide");
  if (S.lastgang) S.lastgang.clearLastgangLink();
}

function vis() {
  const r = S.rolle;
  $("stepVerbrauch").classList.toggle("hide", !(r === "verbraucher" || r === "prosument"));
  $("outVerbrauch").classList.toggle("hide", !(r === "verbraucher" || r === "prosument"));
  $("stepErzeugung").classList.toggle("hide", !(r === "einspeiser" || r === "prosument"));
  $("outErzeugung").classList.toggle("hide", !(r === "einspeiser" || r === "prosument"));
  $("outProsument").classList.toggle("hide", r !== "prosument");
}

function calc() {
  const f = S.rf === "unternehmen" ? (x) => netto(x) : (x) => x;
  $("modeLab").textContent = S.rf === "unternehmen" ? "netto" : "brutto";

  const verbrauchKwh = val("verbrauch");
  const reg = regime(verbrauchKwh);
  const regimeBadge = $("regimeBadge");
  const eReststromSlider = $("eReststrom");

  if (reg === "B") {
    regimeBadge.innerHTML =
      '<span class="badge info">Großverbraucher-Profil (&gt; 100.000 kWh): Genauwert folgt aus ¼h-Lastgang-Analyse — hier vorläufige Spanne 9–11 ct netto</span>';
    if (S.rf !== "unternehmen") {
      document.querySelector('#rechtsform button[data-rf="unternehmen"]').click();
      return;
    }
  } else {
    regimeBadge.innerHTML = "";
  }

  const F = val("F");
  const eR = val("eReststrom");
  const gp = val("grundpreis");

  const sl = $("eCommunity");
  sl.max = eR;
  if (parseFloat(sl.value) > eR) sl.value = eR;
  $("eCommunityMax").textContent = ct(eR);

  // ---- Verbraucher ----
  const eC = parseFloat(sl.value) || 0;
  const m = val("m");
  const ist = val("istPrice");
  $("eCommunityV").textContent = de(eC);
  $("mV").textContent = de(m, 0);

  const result = berechneVerbraucher({
    m,
    F,
    eCommunity: eC,
    eReststrom: eR,
    verbrauchKwh,
    grundpreisMonat: gp,
    istPreisCt: ist,
  });

  $("blended").textContent = de(f(result.preisCt));
  $("istPriceOut").textContent = de(f(ist));
  $("energyAnnual").textContent = eur(f(result.energieAnteil));
  $("grundAnnual").textContent = eur(f(result.grundpreisJahr));
  $("totalAnnual").textContent = eur(f(result.gesamt));
  const saveEl = $("save");
  saveEl.textContent = eur(f(result.ersparnis));
  saveEl.style.color = result.ersparnis >= 0 ? "var(--green-d)" : "#b23b3b";

  // Kenndaten-Zeile (Verivox-Vorbild): Arbeitspreis, Grundpreis, Monatskosten
  // sofort sichtbar statt hinter einem Klick versteckt.
  $("grundAnnualM").textContent = de(f(gp));
  $("totalMonthly").textContent = de(f(result.gesamt / 12));

  const cPrice = F + eC;
  const rPrice = F + eR;

  // Drei Preis-Blöcke: kumuliert (Mischpreis), Community, Reststrom (Team-Feedback).
  $("pbKumuliert").textContent = ct(f(result.preisCt));
  $("pbCommunity").textContent = ct(f(cPrice));
  $("pbReststrom").textContent = ct(f(rPrice));

  const maxP = Math.max(cPrice, rPrice, 1);
  const px = (v) => (v / maxP) * 108;
  $("barCE").style.height = px(eC) + "px";
  $("barCE").textContent = de(f(eC));
  $("barCB").style.height = px(F) + "px";
  $("barCB").textContent = de(f(F));
  $("capC").textContent = ct(f(cPrice));
  $("barRE").style.height = px(eR) + "px";
  $("barRE").textContent = de(f(eR));
  $("barRB").style.height = px(F) + "px";
  $("barRB").textContent = de(f(F));
  $("capR").textContent = ct(f(rPrice));

  // ---- Einspeiser ----
  const kWp = val("kWp");
  const U = val("ueberschuss");
  const iv = val("istVerg");
  const eCP = val("eCommunityP");
  $("eCommunityPV").textContent = de(eCP);

  const freiwilligDV = $("freiwilligDV").checked;
  $("dvWrap").style.display = kWp <= 100 ? "flex" : "none";

  const erzeuger = berechneErzeuger({
    eCommunity: eCP,
    istVerguetung: iv,
    menge: U,
    kWp,
    freiwilligDV,
    eegGrundpreisMonat: 1.6,
  });

  const dv = erzeuger.vermarktung === "direktvermarktung";
  $("potential").textContent = eur(f(erzeuger.potential));
  $("vermarktung").innerHTML = dv
    ? '<span class="badge">Direktvermarktung</span>'
    : "EEG-Festvergütung";
  $("grundE").textContent = dv ? "Individuelles Angebot" : eur(f(erzeuger.grundpreisMonat)) + " /Monat";
  $("nettoRow").classList.toggle("hide", dv);
  $("nettoP").textContent = eur(f(erzeuger.nettoMehrerloes));
  $("dvNote").classList.toggle("hide", !dv);
  $("dvBadge").innerHTML = dv
    ? '<span class="badge">Direktvermarktung — individuelles Angebot erforderlich</span>'
    : "";

  // ---- Prosument ----
  const combProd = dv ? erzeuger.potential : erzeuger.nettoMehrerloes;
  const combined = result.ersparnis + combProd;
  $("combined").textContent = eur(f(combined));
  $("combSave").textContent = eur(f(result.ersparnis));
  $("combProd").textContent = eur(f(combProd)) + (dv ? "" : " (netto)");
}

function bindEvents() {
  document.querySelectorAll("#rollen .tab").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#rollen .tab").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      S.rolle = b.dataset.rolle;
      vis();
      calc();
    });
  });

  document.querySelectorAll("#rechtsform button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#rechtsform button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      S.rf = b.dataset.rf;
      calc();
    });
  });

  document.querySelectorAll("#foerder button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#foerder button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      if (b.dataset.fs === "aus") $("istVerg").value = 2;
      calc();
    });
  });

  $("plz").addEventListener("input", () => {
    plzLookup();
    calc();
  });

  $("verbrauch").addEventListener("input", () => {
    // Manuelle Änderung löst die Lastgang-Verknüpfung (Handover §6.1) — außer
    // das Feld wird gerade programmatisch aus dem Lastgang-Modul selbst befüllt.
    if (!setzeVerbrauchProgrammatisch) loeseLastgangVerknuepfung();
    calc();
  });

  $("lastgangReset").addEventListener("click", () => {
    loeseLastgangVerknuepfung();
  });

  [
    "F",
    "eReststrom",
    "grundpreis",
    "eCommunity",
    "m",
    "istPrice",
    "kWp",
    "ueberschuss",
    "istVerg",
    "eCommunityP",
    "freiwilligDV",
  ].forEach((id) => $(id).addEventListener("input", calc));
}

async function init() {
  await ladePreistabelle();
  bindEvents();
  S.lastgang = initLastgangUI({ onVerbrauchChange: markiereAlsAbgeleitet });
  plzLookup();
  vis();
  calc();
}

init();
