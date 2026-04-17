# Cross-Border Price Transmission in European Power Markets

An interactive data story showing how Germany's renewable surplus crashes day-ahead prices across five Central European bidding zones. 89% of Switzerland's 529 negative-price hours coincide with German negative hours; peak spread of 150 EUR/MWh against Italy.

**[View the live site](https://brianbanna.com/power-price-transmission)**

## Headline numbers

| Metric | Value |
|--------|-------|
| German negative-price hours (Jan 2024 - Jun 2025) | 846 |
| Swiss negative-price hours | 529 |
| Coincidence rate (CH negative during DE negative) | 89% |
| Swiss price on showcase day (12 May 2024, 13:00 CET) | -145.12 EUR/MWh |
| CH-IT spread at that hour | 150 EUR/MWh |
| Swiss price one year later (11 May 2025, 13:00 CET) | -262 EUR/MWh |

## How it works

Day-ahead prices and generation by source from the ENTSO-E Transparency Platform, hourly, January 2024 through June 2025. Five bidding zones:

| Zone | Code | Role |
|------|------|------|
| Germany / Luxembourg | DE_LU | Solar- and wind-dominant, source of the shocks |
| Switzerland | CH | Hydro-backed, absorbs German surplus via interconnectors |
| France | FR | Nuclear baseload, partially insulated |
| Austria | AT | Coupled to Germany, co-moves tightly |
| Italy (North) | IT_NORD | Gas-dependent, still insulated |

Four empirical techniques: cross-market negative-hour correlation, price-gradient flow inference (no physical flow data; direction and magnitude from spreads), merit-order generation stack overlay, and year-over-year shock comparison (May 2024 vs May 2025).

## Visualisation

Seven-step scroll narrative on a sticky five-country map, followed by an interactive 24-hour explorer. Dark-themed, vanilla JS, D3, TopoJSON, Scrollama. No framework, no build step.

- Particle-stream flow arrows along inferred cross-border paths
- Scroll-driven 3D perspective tilt, quantised to reduce GPU recomposites
- Calendar heatmap of negative-price coincidence across all five zones
- Merit-order generation stack for the showcase day
- Cold-open price tween from +45 to -145.12 EUR/MWh

## Quick start

```bash
git clone git@github.com:brianbanna/power-price-transmission.git
cd power-price-transmission

# Serve the site (preprocessed data already committed)
make serve
# Open http://localhost:8000

# Optional: rebuild JSON aggregates from raw CSV
pip install -r requirements.txt
make rebuild
```

## Project structure

```
data/
  entsoe_data_2024_2025.csv         301,391 rows, 23 European markets
scripts/
  preprocess.py                     CSV -> 6 JSON aggregates
  explore.py                        Headline-fact validation
  build_topojson.py                 Five-country map geometry
website/
  index.html                        Single-page scrollytelling
  css/style.css                     Dark theme, custom properties
  js/                               D3 map, narrative, explorer, charts
  data/processed/                   Committed JSON + TopoJSON
```

## Requirements

Python 3.9+. Key dependencies: pandas, geopandas, topojson. Frontend has zero build dependencies (ES modules from CDN).

## License

MIT
