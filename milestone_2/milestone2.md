# The Price of Wind and Sun

**Team HSquareB** &nbsp;·&nbsp; Brian Banna (356437), Lê Thào Huyèn (355566), Hajj Hannah (346545)
**COM-480 Data Visualization** &nbsp;·&nbsp; Milestone 2 &nbsp;·&nbsp; 1 May 2026

`Live prototype  https://com-480-data-visualization.github.io/HSquareB/`
`Source code     https://github.com/com-480-data-visualization/HSquareB`

---

## 1. Project goal

### 1.1 Thesis

On Sunday 12 May 2024, German solar output was high enough that Switzerland's wholesale electricity price dropped to -€145.12 per MWh at 13:00, below Germany's own price at the same hour. Switzerland has far less solar capacity than Germany. Italy, two interconnectors further south, was still trading at positive prices. Germany's renewable build-out has now reached the point where its weekend solar production sets the clearing price across five central European markets at once.

The goal of the visualisation is to make that price transmission visible, not just describe it in text.

### 1.2 Motivation

Renewable integration is usually framed as a domestic story: capacity installed, emissions avoided, bills reduced. The cross-border side gets less attention because it is harder to show. Interconnectors turn national energy policy into a regional effect. Most of the time they just smooth out weather variation. When supply overshoots demand, they propagate the price drop across the network within the hour. Anyone following European power markets benefits from seeing that mechanism directly, and from seeing how much it has intensified between 2024 and 2025.

### 1.3 Questions we want a reader to walk away able to answer

- Does Germany's solar peak reach into the price formation of its neighbours?
- Which of those neighbours absorb the shock hardest, and why?
- How fast has this pattern intensified across the eighteen-month window?
- Who is insulated from it, and what insulates them?

### 1.4 Audience

Energy-literate general readers, undergraduate economics and energy students, and anyone following the European power-market news cycle. The site assumes no meteorology and no electricity-market background beyond "wholesale prices exist." Technical terms (bidding zone, merit-order stack, duck curve, Dunkelflaute) are introduced inline the first time they appear, so the reader can follow the argument without a glossary.

![The hero frame of the live prototype. At 13:00 on 12 May 2024, Switzerland clears at -€145.12 per MWh, lower than Germany at the same hour. Flow arrows show the inferred direction of cross-border power flows.](figures/fig_02_step3_peak.png)

---

## 2. Exploratory data analysis

We use the ENTSO-E Transparency Platform download covering 1 January 2024 through 30 June 2025: 301,391 hourly observations across 23 bidding zones, with day-ahead prices and generation broken down by fuel. A *bidding zone* is the area within which the wholesale electricity price is the same at any given hour. Most countries are a single zone, Italy is split into several regional zones, and Germany shares one with Luxembourg. We filter to five zones that share physical interconnectors across the Alps and the Rhine: Switzerland (CH), Germany-Luxembourg (DE_LU), France (FR), Northern Italy (IT_NORD), and Austria (AT). Belgium and the Netherlands also border Germany and see a lot of negative prices, but they are two interconnectors removed from Switzerland and sit outside the scope we care about here.

Germany is at the centre of this story for three concrete reasons. It has far more installed renewable capacity than Switzerland, the country at the heart of our story: around 90 GW of solar and 70 GW of onshore and offshore wind in 2024, against Switzerland's roughly 7 GW of solar and wind combined. That gives it the scale to move continental prices on its own. It sits at the physical centre of the synchronous area and shares direct interconnectors with four of the other five focus zones, so a price shock on its grid travels outward through the rest. And the causality only runs one way: when the German market clears below zero, the neighbours almost always clear below zero too (Section 2.2 gives the numbers), while positive German hours line up with positive hours everywhere else. The German *Energiewende* is the policy driving the effect we are measuring, so the rest of the analysis treats the other four countries as the places that catch the signal rather than the places that produce it.

### 2.1 Distribution of negative-price hours

We start by counting how often each market clears below zero. Over eighteen months:

| Country | Negative-price hours | Share of total |
|---|---:|---:|
| Germany (DE_LU) | 846 | 6.5% |
| France (FR) | 715 | 5.5% |
| Austria (AT) | 584 | 4.5% |
| Switzerland (CH) | 529 | 4.0% |
| Italy (IT_NORD) | 0 | 0.0% |

The ordering points to two different dynamics behind the numbers. France's 715 hours are mostly produced at home: its nuclear fleet is slow to ramp down, so when wind output is high the combined supply overshoots demand even without imports from Germany. Austria's count comes from a different place. Austria and Germany ran as a single bidding zone until 2018 and are still inside the same synchronous area, so negative hours in one almost always show up in the other. Switzerland is the interesting case. It has some solar but not nearly enough to oversupply its own market, no wind to speak of, and a flexible hydro fleet. On its own fundamentals nothing should push its clearing price below zero. It still went negative 529 times. Italy, on the other side of the Alps with a gas-heavy generation mix, never went negative.

![Step 4 of the narrative: calendar heatmap with a DE / CH tab toggle. Each cell is one hour across eighteen months. The DE panel shows dense clusters of negative prices on summer midday hours; the CH panel shows a sparser version of the same pattern. The density difference between the two tabs is the visual form of Section 2.1.](figures/fig_03_heatmap.png)

### 2.2 Coincidence with German negative hours

For each neighbouring country we counted how many of its own negative-price hours fell inside the same hour as a German negative. Austria sits at 89.7% (524 of 584), Switzerland at 88.8% (470 of 529), and France at 80.6% (576 of 715). Austria's high number is not surprising. It shared a single bidding zone with Germany until 2018 and is still inside the same synchronous area, so the two markets clear together at the bottom. France has a larger absolute count but a lower coincidence rate, because a lot of its negative hours come from its own nuclear-plus-wind supply stack rather than from imports.

Switzerland is the finding that drives the rest of the project. It has no structural reason to track Germany like that. It is outside the EU internal market, not in the same bidding zone, and only physically connected through AC lines across the Rhine and the Alps. And yet, on 88.8% of the hours its price drops below zero, Germany is already there. Switzerland is not producing those hours. It is importing them through the grid.

### 2.3 The duck curve is widening, fast

The *duck curve* is the shape you get when you plot a typical day's electricity price (or net load) hour by hour and solar dominates the middle of the day. Prices drop through the morning, hit a deep midday trough (the duck's belly) as cheap solar floods the system, and then climb steeply in the evening (the duck's head) when the sun sets and demand peaks. The deeper the belly, the more solar is in the mix.

We computed the monthly average price profile for each country across all eighteen months. Germany's average midday price at hour 13 fell from +€16.17 per MWh in May 2024 to -€12.15 per MWh in May 2025. In one year, on a monthly-average basis, the duck's belly crossed below zero.

All five countries have the same daily shape: a midday trough at hour 13 or 14, an evening peak at hour 19. What differs is the absolute level and the depth of the trough. That is what Step 7 of the visualisation communicates. The daily rhythm is shared, the intensity is not. We only noticed this after running the EDA and seeing the peak hours line up across all five.

### 2.4 Seasonality of renewable share

Germany's monthly renewable share (solar + wind + hydro as a fraction of total generation) approaches 70% in the summer months of 2024 and exceeds it in 2025. Italy stays heavily gas-dependent throughout. Austria sits near 84% year-round, mostly hydro with a growing share of wind and solar. France runs at a stable 20 to 30%, dominated by nuclear with fossil fuels as a buffer. Each country's mix produces a distinct price profile, and the narrative has to make those differences visible.

![Step 7 of the narrative: five-country small multiples of the average 24-hour price profile. The same trough-and-peak daily shape appears in all five, but at different levels. Italy holds a positive midday average; Germany's trough sits near zero; Switzerland and Austria track Germany closely.](figures/fig_05_smallmults.png)

### 2.5 Three insights the visualisation is built around

1. **Coincidence.** Swiss and German negative hours line up 88.8% of the time.
2. **Inversion.** At 13:00 on 12 May 2024, Switzerland cleared below Germany. The price shock can over-shoot in the importing market.
3. **Evolution.** The midday collapse has sharpened between May 2024 and May 2025 on a monthly-average basis, not just in outlier hours.

Each of the three shows up explicitly in one of the seven narrative steps.

---

## 3. Visualisation plan

### 3.1 Architecture

The site is a single scrollytelling page with a sticky map underneath. The five-country map stays on screen throughout, and the reader scrolls through seven editorial cards that change its state (time of day, price colouring, flow arrows, annotations). After the last card, the scroll opens into an interactive explorer where the reader can drive the same map themselves.

The prototype is already functional end to end, so we include screenshots of the live build rather than the sketches the brief asked for. Screenshots of the actual build give a more accurate picture of the visual system, the colour scale, and the type hierarchy than sketches would at this stage, and we would rather the reader of this document see what we are actually shipping.

### 3.2 The seven narrative steps

Two terms used in the table below. A *mix donut* is a small donut chart showing the share of each fuel in the current generation mix (solar, wind, nuclear, gas, hydro). A *merit-order stack* is the mechanism the market uses to set a price: generators are lined up from cheapest marginal cost (nuclear, renewables) to most expensive (gas peakers), stacked up until supply meets demand, and the last unit needed sets the clearing price for the whole market. When cheap renewables alone can cover demand, the price collapses. When they overshoot demand, it goes negative.

| Step | Beat | Key visual |
|---|---|---|
| 1 | Midnight baseline. Calibrate the reader on the map, colour scale, and legend. | Five-country map, muted prices, clock at 00:00. |
| 2 | Dawn solar ramp. Germany wakes up; the mix donut shows solar dominance. | Map tints, generation donut pinned beside DE. |
| 3 | **The peak moment.** 13:00, 12 May 2024. Switzerland at -€145.12, below Germany. Flow arrows radiate from DE and out of CH. | Ice-white CH, flow arrows, hero number bloom. |
| 4 | Year in one view. Calendar heatmap of every hour in 2024 and 2025 for DE and CH, toggleable. | Canvas heatmap, 13,104 cells per country. |
| 5 | Merit-order stack. Germany's generation stack for the showcase day with price overlay and load line. | Stacked area + line chart, animated reveal. |
| 6 | Duck curve forming. Monthly cycling of Germany's profile from January 2024 to June 2025 over a ghost annual average. | 24-hour line chart, animated month transitions. |
| 7 | Five identities. Small-multiples grid of all five countries' annual profiles. | 3-by-2 grid of compact 24-hour line charts. |

### 3.3 Interactive explorer

After the guided story, the reader can drive the map themselves. A timeline scrubber covers one full showcase day in hourly steps. Playback runs at 1x, 2x or 4x speed, with Space and the arrow keys as keyboard shortcuts. Clicking any country opens a sidebar showing that country's generation stack, daily price profile with the annual average as a ghost line, and summary stats (current price, renewable share, spread to Italy). A colour-mode toggle recolours the map by renewable share instead of price.

![Interactive explorer: the reader controls the same canvas directly. Timeline scrubber at hour 13, Switzerland sidebar open with generation stack and daily profile, play / pause and speed controls at the bottom.](figures/fig_06_explorer.png)

### 3.4 Visual language

The site runs dark-only. The background is a three-level navy ramp. The price scale is a diverging sequential from ice-white for deep negatives (where the drama lives), through the navy baseline, to warm orange and red for positive peaks. Using ice-white for extreme negatives is a deliberate inversion of the usual "darker equals more extreme" convention: negative prices are the thing we want the reader to notice, so they get the brightest treatment. Typography pairs Fraunces (variable serif, used at display sizes for the hero numbers and editorial copy) with JetBrains Mono (for every data value, timestamp, country code, and legend). Numbers are never set in the serif. The palette choice draws on Lecture 6.1 (perception and colour) and the typographic hierarchy on Lecture 7.1 (designing visualisations).

---

## 4. Plan of attack

### 4.1 Minimum viable product

All of the following are already working in the live prototype:

- Five-country map rendered from a 17 KB TopoJSON with price-driven colouring and flow arrows
- Seven-step narrative scroll wired through Scrollama, with per-step map state changes
- Timeline scrubber on the explorer with play / pause, speed control, and keyboard shortcuts
- Reproducible Python pipeline that regenerates every JSON artefact from the raw CSV
- Click-to-inspect country sidebar with generation stack, daily profile, and summary stats
- Price vs renewable-share colour toggle

### 4.2 Stretch ideas

Ranked by how much they would add if we have time before Milestone 3, each of which can be dropped without breaking the core argument:

- **Guided-tour auto-play** that scrolls the site itself with subtitles, for the screencast and for non-scrolling viewers.
- **Keyboard accessibility on the map** so every country can be reached with Tab and opened with Enter.
- **Graceful empty states and error messaging** across all charts.
- **Colour-vision-deficient audit** of the generation-stack palette (solar and gas currently sit close in CVD space).
- **Annotation layer** for named events: German holidays, negative-price records, and winter *Dunkelflaute* hours (German for "dark doldrums", meaning stretches of low sun and low wind when renewables under-produce and prices spike).
- **Sonification of one day's price curve** as an optional audio track, grounded in Lecture 11.2.

The first three are already in progress. The remaining three are honest stretch.

### 4.3 Tools

| Component | Tool |
|---|---|
| Data preprocessing | Python 3.9, pandas, pyarrow |
| Map geometry | world-atlas (Natural Earth), topojson-client |
| Rendering | D3 v7 (SVG and Canvas), vanilla ES modules |
| Scroll orchestration | Scrollama |
| Typography | Fraunces (variable serif), JetBrains Mono |
| Hosting | GitHub Pages (static, `/docs` folder, `.nojekyll`) |

No framework, no build step. The whole site is served from static files on GitHub Pages.

### 4.4 Course lectures

Past lectures used in the work so far:

- **1.1 Introduction to data viz** and **1.2 Web dev**: project framing, scaffolding.
- **2 JavaScript** and **3 More JavaScript**: vanilla ES modules, DOM work, no jQuery.
- **4.1 Data** and **4.2 D3**: joins, scales, transitions, stacked areas, small multiples.
- **5.1 Interaction** and **5.2 More interactive D3**: timeline scrubber, sidebar open/close, hover affordances.
- **6.1 Perception and colours**: price scale design, ice-white zero-crossing, dark-mode contrast choices.
- **6.2 Mark and channel**: encoding trade-offs for the generation stack and the flow arrows.
- **7.1 Designing viz** and **7.2 Do and don'ts**: hierarchy, typography pairing, pitfalls avoided (no 3D, no pie slices beyond the one-shot solar donut in Step 2).
- **8.1 Maps** and **8.2 Practical maps**: conic-conformal projection centred on Munich, TopoJSON for five countries only, flow-arrow layer.

Future lectures we expect to lean on for Milestone 3:

- **9 Text**: annotation layer and final labelling pass.
- **10 Graphs**: formalisation of the flow-arrow layer as a directed network between bidding zones.
- **11.1 Tabular data**: sidebar summary tables, final polish.
- **11.2 Sound viz**: optional sonification stretch idea.
- **12.1 Storytelling**: final editorial pass on card copy, pacing, and transitions.
- **12.2 Beyond visualisation**: process-book reflections.

### 4.5 Prototype status

The end-to-end prototype is live at [https://com-480-data-visualization.github.io/HSquareB/](https://com-480-data-visualization.github.io/HSquareB/). All seven narrative steps are wired, the explorer is interactive, and the Python pipeline regenerates every JSON artefact from the raw CSV in under a minute. The current phase is polish, accessibility, and mobile responsiveness, and it will continue through to Milestone 3 alongside the screencast and the process book.

### 4.6 Division of labour

| Member | Primary ownership |
|---|---|
| Brian Banna | Data pipeline (Python, ENTSO-E to JSON). Front-end engineering: D3 chart modules, scroll orchestration, map rendering, interactive explorer. |
| Lê Thào Huyèn | Narrative design and storytelling: the seven-step structure, card copy, hero-moment framing, pedagogical sequencing. Early sketches and reading-flow decisions. |
| Hajj Hannah | Exploratory data analysis, visual design system: colour palette, typography pairing, small-multiples visual language. Early sketches and page composition. |

Sketching and storytelling were shared across all three members in the design phase. Ownership in the table reflects who led each domain through to shipped code or shipped copy.
