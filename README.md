# Robin Gut Strom · Potenzialrechner

Interaktiver Potenzialrechner für das Energy-Sharing-Modell von Robin Gut Strom
(in Zusammenarbeit mit We Share Energy). Zeigt anhand von Postleitzahl, Verbrauch
bzw. Erzeugung eine unverbindliche Preis- und Potenzial-Indikation.

**Live:** https://klassenmedia.github.io/robingut-potenzialrechner/

## Hinweis

Alle Angaben sind eine unverbindliche Indikation. Verbindliche Preise und Angebote
erfolgen ausschließlich über Robin Gut Strom / We Share Energy.

## Lokal starten

Statische Seite, kein Build-Step nötig:

```bash
npx serve .
```

## Preisdaten aktualisieren

```bash
node scripts/fetch-preise.mjs
```

## Tests

```bash
node tests/engine.test.mjs
```
