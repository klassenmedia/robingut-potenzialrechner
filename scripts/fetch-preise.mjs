// Ruft die WSE-Preis-API für eine feste PLZ-Liste ab und schreibt data/preise.json + data/einspeiser.json.
// CORS erlaubt nur weshareenergy.de-Domains -> dieses Script läuft serverseitig (Node), nicht im Browser.
// Rate-Limit der API: 50 Requests -> Drosselung 1,5s pro Call, Fehler je PLZ werden übersprungen.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const API_BASE = "https://weshareenergy.de/api";
const SLUG = "robin-gut-strom";
const VERBRAUCHSSTUFEN = [2500, 15000, 50000];
const THROTTLE_MS = 1500;

const PLZ_LISTE = [
  "41749", // Viersen (Spec-Referenz, Default)
  "41747",
  "41748", // Viersen-Umland
  "32547",
  "32549", // Bad Oeynhausen
  "32105", // Bad Salzuflen
  "49152", // Bad Essen
  "32425", // Minden
  "33613", // Bielefeld
  "30627", // Hannover
  "40625", // Düsseldorf
  "50823", // Köln
  "13629", // Berlin
  "22047", // Hamburg
  "81371", // München
  "60311", // Frankfurt
  "70199", // Stuttgart
  "04155", // Leipzig
  "01277", // Dresden
  "90441", // Nürnberg
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function calculatePrice(postalCode, annualConsumptionKwh) {
  const res = await fetch(`${API_BASE}/calculate-price`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      postal_code: postalCode,
      annual_consumption_kwh: annualConsumptionKwh,
      slug: SLUG,
      refcode: null,
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} für PLZ ${postalCode} @ ${annualConsumptionKwh} kWh`);
  }
  const data = await res.json();
  if (data.requires_district_selection) {
    throw new Error(`PLZ ${postalCode} verlangt Straßenauswahl (mehrere Netzgebiete) — übersprungen`);
  }
  return data;
}

async function fetchPricingData() {
  const res = await fetch(`${API_BASE}/pricing-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug: SLUG }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} bei /pricing-data`);
  }
  return res.json();
}

async function main() {
  const preise = {};
  let ok = 0;
  let failed = 0;

  for (const plz of PLZ_LISTE) {
    const staffel = [];
    let stadt = null;
    let fBrutto = null;
    let eReststromBrutto = null;
    let plzFailed = false;

    for (const kwh of VERBRAUCHSSTUFEN) {
      try {
        const data = await calculatePrice(plz, kwh);
        stadt = data.city ?? stadt;
        fBrutto = data.minimum_energy_price_gross ?? fBrutto;
        const reststrom = data.energy_price - data.minimum_energy_price_gross;
        eReststromBrutto = reststrom;
        staffel.push([kwh, data.monthly_base_price]);
        ok++;
      } catch (err) {
        console.warn(`Übersprungen: PLZ ${plz} @ ${kwh} kWh — ${err.message}`);
        failed++;
        plzFailed = true;
      }
      await wait(THROTTLE_MS);
    }

    if (!plzFailed && stadt) {
      preise[plz] = {
        stadt,
        fBrutto: Number(fBrutto.toFixed(5)),
        eReststromBrutto: Number(eReststromBrutto.toFixed(2)),
        grundpreisStaffel: staffel,
      };
      console.log(`✓ ${plz} ${stadt}: F=${preise[plz].fBrutto} ct, E_Reststrom=${preise[plz].eReststromBrutto} ct`);
    } else {
      console.warn(`✗ PLZ ${plz} komplett übersprungen (mind. ein Call fehlgeschlagen).`);
    }
  }

  await writeFile(join(DATA_DIR, "preise.json"), JSON.stringify(preise, null, 2) + "\n", "utf-8");
  console.log(`\npreise.json geschrieben: ${Object.keys(preise).length} PLZ, ${ok} erfolgreiche / ${failed} fehlgeschlagene Calls.`);

  try {
    const pricingData = await fetchPricingData();
    const einspeiser = {
      grundpreisEegMonat: Number((pricingData.producer_base_price / 12).toFixed(2)),
      durchschnittsAbnahmepreisCt: pricingData.producer_avg_purchase_price_ct,
    };
    await writeFile(join(DATA_DIR, "einspeiser.json"), JSON.stringify(einspeiser, null, 2) + "\n", "utf-8");
    console.log("einspeiser.json geschrieben:", einspeiser);
  } catch (err) {
    console.warn(`einspeiser.json konnte nicht geschrieben werden: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("Abbruch:", err);
  process.exitCode = 1;
});
