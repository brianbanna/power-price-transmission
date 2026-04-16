# Cross-Border Price Transmission in the European Power Market

> An interactive data story about how renewable supply shocks in one bidding zone propagate through the Central European grid and drag neighbouring markets into coincident negative-price episodes.

## Context

Between January 2024 and June 2025 the day-ahead electricity price in Germany went negative for 846 hours, more than 35 full days in which producers were paying consumers to take their power. Switzerland, which produces almost no solar of its own, spent 529 hours below zero in the same window. Roughly 89 per cent of those Swiss negative hours occurred during German negative hours. This project quantifies and visualises that coupling.

The central case study is a single Sunday, 12 May 2024, when at 13:00 CET Switzerland printed a day-ahead price of minus 145.12 euros per megawatt-hour, ten euros deeper than Germany, while Italy stayed at plus 5. The spread between the Swiss and Italian markets that hour, 150 euros per megawatt-hour, is the visual anchor of the piece.

## Data

Source: ENTSO-E Transparency Platform, day-ahead prices and generation by source, hourly frequency, January 2024 through June 2025. Five bidding zones are in scope:

| Zone | Code | Role in the story |
|------|------|--------------------|
| Switzerland | CH | Hydro-backed shock absorber |
| Germany / Luxembourg | DE_LU | Solar- and wind-dominant, source of the shocks |
| France | FR | Nuclear baseload |
| Italy (North) | IT_NORD | Gas-dependent, still insulated |
| Austria | AT | Coupled to Germany through shared bidding |

The raw CSV is 301,392 rows across 23 European markets. `scripts/preprocess.py` filters to the five focus zones, forward-fills the small amount of missing data, computes a renewable share column, and emits six focused JSON aggregates under `data/processed/` that the frontend loads on demand.

## Method

The analysis is empirical rather than model-based. Four techniques thread through the piece:

1. Cross-market correlation of negative-price hours, quantifying the co-movement between German and Swiss day-ahead prices.
2. Price-gradient inference of cross-border flow direction and magnitude. The dataset has no physical flow data, so flow arrows are drawn from low-price to high-price markets with thickness proportional to the absolute price spread. This is how traders think about arbitrage across interconnectors.
3. Merit-order visualisation of the German generation stack on the showcase day, overlaid with the day-ahead price line to make the causal link between zero-marginal-cost renewables and negative prices concrete.
4. A year-over-year comparison of the 12 May 2024 shock against 11 May 2025, showing that the same kind of Sunday pushed Swiss prices to minus 262 euros per megawatt-hour a year later, nearly doubling the magnitude of the 2024 event.

## Visualisation

The frontend is a single static page, dark-themed, built on vanilla JavaScript, D3, TopoJSON and Scrollama with no framework and no build step. The map of the five countries is always visible. Narrative cards overlay the left side during the scrollytelling sequence and dissolve into an interactive explorer at the bottom, where the reader can scrub through 24 hours of the showcase day and watch the map react in real time.

Implementation highlights:

- Pre-sampled particle streams along inferred flow paths, cached in typed arrays for per-frame lookup.
- Sticky scene container so the map stays pinned through the narrative and the explorer without fixed-positioning workarounds.
- Scroll-driven 3D perspective tilt on the map SVG, quantised to elide redundant GPU re-composites.
- Cartographic cartouche with compass rose, scale bar and degree edge labels rendered inside the SVG.
- Hero cold-open teaser that tweens from plus 45 euros to minus 145.12 euros on page load and then pins.

## Running locally

```bash
git clone git@github.com:brianbanna/power-price-transmission.git
cd power-price-transmission

# Optional: regenerate the JSON aggregates from the raw CSV
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/preprocess.py

# Serve the frontend
python3 -m http.server 8000
```

Then open `http://localhost:8000/docs/`. The preprocessed JSON files are already committed under `docs/data/processed/`, so the `scripts/preprocess.py` step is only needed if you want to rebuild them from the raw ENTSO-E CSV.

## Repository layout

```
power-price-transmission/
├── data/
│   └── entsoe_data_2024_2025.csv    Raw ENTSO-E dataset (immutable)
├── scripts/
│   ├── preprocess.py                 CSV to JSON pipeline
│   ├── explore.py                    Headline-fact validation
│   └── build_topojson.py             Five-country map geometry
└── docs/
    ├── index.html
    ├── css/style.css
    ├── data/processed/               JSON aggregates for the frontend
    └── js/
        ├── main.js
        ├── map.js
        ├── narrative.js
        ├── explorer.js
        ├── charts/
        └── utils/
```

## Credits

Day-ahead price and generation data: [ENTSO-E Transparency Platform](https://transparency.entsoe.eu/).
Map geometry: Natural Earth 1:50m via [world-atlas](https://github.com/topojson/world-atlas).

## License

MIT
