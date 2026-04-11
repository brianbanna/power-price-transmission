// Map module — renders the five-country topology and exposes a tiny
// controller surface (`update`, `destroy`) the rest of the app uses to
// drive state changes during scroll.
//
// Task 2.2 pivot: this pulls forward the basic topology render from
// Task 3.1 so the map-dominant layout does not expose a full-viewport
// black rectangle. Colors, arrows, and labels land in Tasks 3.3–3.9.

import * as d3 from "d3";
import * as topojson from "topojson-client";

import { priceColor } from "./utils/colors.js";

// Conic conformal centered on central Europe (see design_system.md §Map
// projection). Tuned so the five focus countries fill the viewport with
// Switzerland slightly above visual center.
const PROJECTION_CONFIG = {
    center: [10, 48],
    rotate: [-10, 0, 0],
    parallels: [43, 55],
};

// The geometry is rendered once and then re-fitted on window resize.
const FIT_PADDING = 64;

// Concentric graticule circles — a cartographic atlas touch that also
// reads as a power-grid radar sweep. Rendered as distance rings around
// the map's anchor point (Munich, roughly 48N 10E) in kilometres.
const GRATICULE_RINGS_KM = [200, 400, 600, 800];
const GRATICULE_ANCHOR = [10, 48];
const GRATICULE_MERIDIANS = [0, 5, 10, 15, 20];
const GRATICULE_PARALLELS = [40, 45, 50, 55];
const EARTH_KM_PER_DEGREE = 111.32;

// Cartographic cartouche — compass rose + scale bar. Positioned in the
// viewport's bottom-left clear of the clock (bottom-right) and the HUD
// (top-right). Measured in CSS pixels against the fitted viewBox so
// they sit at fixed offsets regardless of resize.
const CARTOUCHE_MARGIN_X = 42;
const CARTOUCHE_BOTTOM = 120;
const COMPASS_RADIUS = 24;
const SCALE_BAR_KM = 200;

// Per-country label position overrides (added to the geometric centroid).
// CH and AT are small and their centroids land awkwardly on borders; we
// nudge in whichever direction gives the cleanest placement. Values are
// in projected pixel space (post-fitExtent), roughly in the 0..~1440 range.
const LABEL_NUDGE_PX = {
    CH: [-4, 4],
    AT: [4, 6],
    DE: [0, -4],
    FR: [-30, 30],
    IT: [-14, 10],
};

// Interconnector pairs — the 8 connected markets where a price gradient
// implies cross-border electricity flow. Direction is inferred from the
// price differential (low → high); see PROJECT_TRACKER.md Decision 3.
const INTERCONNECTORS = [
    ["CH", "DE"],
    ["CH", "FR"],
    ["CH", "IT"],
    ["CH", "AT"],
    ["DE", "AT"],
    ["DE", "FR"],
    ["FR", "IT"],
    ["AT", "IT"],
];

// Spread threshold (EUR/MWh) below which arrows are suppressed entirely
// — a tiny price differential rarely produces material cross-border flow
// and makes the map noisy.
const ARROW_SPREAD_THRESHOLD = 5;

// Linear mapping from |spread| → stroke width in pixels. At 150 EUR
// spread (CH→IT at the peak moment) the arrow reaches MAX_WIDTH.
const ARROW_MIN_WIDTH = 1.4;
const ARROW_MAX_WIDTH = 6;
const ARROW_WIDTH_PIVOT = 150;

// Particle flow — a generative dot stream riding each active flow path.
// Replaces the old marching-ants dashed stroke with something that feels
// like actual current moving through the interconnector. The guide path
// remains in the DOM at very low opacity so the reader still sees the
// route when no particles happen to be on it.
//
// Density scales with |spread|: a small 10 EUR differential carries a
// handful of particles; the 150 EUR peak-moment shocks swarm. Particles
// are pooled per flow and recycled (t wraps from 1 → 0) so the DOM
// population stays flat once a flow is active.
const PARTICLE_MIN_COUNT = 3;
const PARTICLE_MAX_COUNT = 16;
const PARTICLE_BASE_RADIUS = 1.4;
const PARTICLE_FOCUS_RADIUS = 2.2;
const PARTICLE_BASE_SPEED = 0.00035; // fraction of path length per ms
const PARTICLE_FOCUS_SPEED = 0.00055;

export function createMap(selector, config) {
    const container = document.querySelector(selector);
    if (!container) {
        throw new Error(`createMap: no element matches ${selector}`);
    }

    const { topology, showcase } = config;
    const countries = topojson.feature(topology, topology.objects.countries);
    // Stable ISO → feature map for fast lookups.
    const featureByIso = new Map(countries.features.map((f) => [f.id, f]));

    const svg = d3
        .select(container)
        .append("svg")
        .attr("xmlns", "http://www.w3.org/2000/svg")
        .attr("role", "img")
        .attr("aria-label", "Map of Switzerland, Germany, France, Italy and Austria");

    // Shared <defs> block — currently holds the arrow marker used by the
    // flow layer. Markers inherit the path's stroke via context-stroke.
    const defs = svg.append("defs");
    defs.append("marker")
        .attr("id", "flow-arrow-head")
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 7)
        .attr("refY", 5)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M 0 1 L 8 5 L 0 9 z")
        .attr("fill", "context-stroke");

    const projection = d3
        .geoConicConformal()
        .center(PROJECTION_CONFIG.center)
        .rotate(PROJECTION_CONFIG.rotate)
        .parallels(PROJECTION_CONFIG.parallels);

    const pathGen = d3.geoPath(projection);

    // Layer order: graticule → countries → flow guides → particles →
    // labels → cartouche. Cartouche sits on top so compass + scale bar
    // always remain legible above country fills.
    const gGraticule = svg.append("g").attr("class", "graticule");
    const gRings = svg.append("g").attr("class", "graticule__rings");
    const gCountries = svg.append("g").attr("class", "countries");
    const gFlows = svg.append("g").attr("class", "flows");
    const gParticles = svg.append("g").attr("class", "particles");
    const gLabels = svg.append("g").attr("class", "labels");
    const gCartouche = svg.append("g").attr("class", "cartouche");

    // Build the cartouche once — its internal geometry is static
    // (compass tick angles, bar sub-divisions). The outer transform is
    // re-applied on every resize to keep it pinned to the viewport
    // bottom-left. Scale bar pixel length is also computed per-resize
    // against the projection.
    const gCompass = gCartouche.append("g").attr("class", "cartouche__compass");
    gCompass.append("circle")
        .attr("class", "cartouche__compass-ring")
        .attr("r", COMPASS_RADIUS);
    gCompass.append("circle")
        .attr("class", "cartouche__compass-ring cartouche__compass-ring--inner")
        .attr("r", COMPASS_RADIUS - 6);
    // Eight-point tick marks, longer on the cardinals.
    for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const isCardinal = i % 4 === 0;
        const outer = COMPASS_RADIUS - 1;
        const inner = outer - (isCardinal ? 8 : 4);
        gCompass.append("line")
            .attr("class",
                `cartouche__compass-tick${isCardinal ? " cartouche__compass-tick--cardinal" : ""}`)
            .attr("x1", Math.sin(angle) * inner)
            .attr("y1", -Math.cos(angle) * inner)
            .attr("x2", Math.sin(angle) * outer)
            .attr("y2", -Math.cos(angle) * outer);
    }
    // North-pointing arrow — a thin isoceles triangle from center to
    // the inner-ring top. The cyan/glow stroke gives it the only color
    // accent on the cartouche so it naturally draws the eye.
    gCompass.append("path")
        .attr("class", "cartouche__compass-needle")
        .attr("d", `M0,${-COMPASS_RADIUS + 3} L3,4 L0,0 L-3,4 Z`);
    // Cardinal letters — N only (keeps it minimal).
    gCompass.append("text")
        .attr("class", "cartouche__compass-letter")
        .attr("y", -COMPASS_RADIUS - 7)
        .text("N");

    const gScale = gCartouche.append("g").attr("class", "cartouche__scale");
    gScale.append("line")
        .attr("class", "cartouche__scale-bar")
        .attr("y1", 0).attr("y2", 0);
    gScale.append("line")
        .attr("class", "cartouche__scale-tick")
        .attr("y1", -4).attr("y2", 4);
    gScale.append("line")
        .attr("class", "cartouche__scale-tick cartouche__scale-tick--end")
        .attr("y1", -4).attr("y2", 4);
    gScale.append("line")
        .attr("class", "cartouche__scale-tick cartouche__scale-tick--mid")
        .attr("y1", -3).attr("y2", 3);
    gScale.append("text")
        .attr("class", "cartouche__scale-label")
        .attr("y", -10)
        .text(`${SCALE_BAR_KM} km`);
    gScale.append("text")
        .attr("class", "cartouche__scale-origin")
        .attr("y", 16)
        .text("0");
    gScale.append("text")
        .attr("class", "cartouche__scale-end")
        .attr("y", 16)
        .text(SCALE_BAR_KM);

    // Graticule edge labels — degree readouts on meridians (top edge)
    // and parallels (left edge). Built once, positioned per-resize so
    // they always sit just inside the viewport frame.
    const gEdgeLabels = gCartouche.append("g").attr("class", "cartouche__edges");
    const meridianLabels = gEdgeLabels
        .selectAll("text.cartouche__edge-lon")
        .data(GRATICULE_MERIDIANS)
        .join("text")
        .attr("class", "cartouche__edge-label cartouche__edge-lon")
        .text((d) => `${d}°E`);
    const parallelLabels = gEdgeLabels
        .selectAll("text.cartouche__edge-lat")
        .data(GRATICULE_PARALLELS)
        .join("text")
        .attr("class", "cartouche__edge-label cartouche__edge-lat")
        .text((d) => `${d}°N`);

    // Meridians + parallels — thin dashed hairlines covering the region.
    const meridianLines = gGraticule
        .selectAll("path.graticule__meridian")
        .data(GRATICULE_MERIDIANS)
        .join("path")
        .attr("class", "graticule__line graticule__meridian");

    const parallelLines = gGraticule
        .selectAll("path.graticule__parallel")
        .data(GRATICULE_PARALLELS)
        .join("path")
        .attr("class", "graticule__line graticule__parallel");

    // Concentric distance rings around the anchor point.
    const ringCircles = gRings
        .selectAll("circle.graticule__ring")
        .data(GRATICULE_RINGS_KM)
        .join("circle")
        .attr("class", "graticule__ring")
        .attr("fill", "none");

    // Anchor cross at the map's geographic center — a tiny "+" glyph.
    const crosshair = gRings.append("g").attr("class", "graticule__crosshair");
    crosshair.append("line").attr("class", "graticule__crosshair-line");
    crosshair.append("line").attr("class", "graticule__crosshair-line");

    const countryPaths = gCountries
        .selectAll("path")
        .data(countries.features)
        .join("path")
        .attr("class", "country")
        .attr("data-iso", (d) => d.id);

    // Label groups — one per country. Each group holds two <text> nodes
    // (ISO code above, price below) plus an invisible halo rect that we
    // can show behind the label on the peak moment.
    const labelGroups = gLabels
        .selectAll("g.label")
        .data(countries.features)
        .join("g")
        .attr("class", "label")
        .attr("data-iso", (d) => d.id);

    labelGroups.append("text")
        .attr("class", "label__code")
        .text((d) => d.id);

    labelGroups.append("text")
        .attr("class", "label__price")
        .text("—");

    function resize() {
        let { clientWidth, clientHeight } = container;
        // The map container is position:fixed; inset:0 so its layout
        // size always equals the viewport. If clientWidth/Height are
        // still 0 on first-paint bootstrap, fall back to the viewport
        // itself so the projection fits correctly and centroids get
        // computed. Without this fallback, the leader line never
        // appears during the narrative because getCountryCentroidPx
        // returns null on every step enter.
        if (!clientWidth) clientWidth = window.innerWidth;
        if (!clientHeight) clientHeight = window.innerHeight;
        if (!clientWidth || !clientHeight) return;
        svg.attr("viewBox", `0 0 ${clientWidth} ${clientHeight}`);
        projection.fitExtent(
            [
                [FIT_PADDING, FIT_PADDING],
                [clientWidth - FIT_PADDING, clientHeight - FIT_PADDING],
            ],
            countries,
        );

        countryPaths.attr("d", pathGen);

        // Draw meridians as line segments spanning the parallel extent.
        const [lat0, lat1] = [
            GRATICULE_PARALLELS[0],
            GRATICULE_PARALLELS[GRATICULE_PARALLELS.length - 1],
        ];
        meridianLines.attr("d", (lon) => {
            const samples = d3.range(lat0, lat1 + 0.01, 0.5).map((lat) => [lon, lat]);
            return d3.line()(samples.map((p) => projection(p)));
        });

        const [lon0, lon1] = [
            GRATICULE_MERIDIANS[0],
            GRATICULE_MERIDIANS[GRATICULE_MERIDIANS.length - 1],
        ];
        parallelLines.attr("d", (lat) => {
            const samples = d3.range(lon0, lon1 + 0.01, 0.5).map((lon) => [lon, lat]);
            return d3.line()(samples.map((p) => projection(p)));
        });

        // Concentric rings use projected distance: convert km → degrees,
        // then measure the projected distance along the north meridian.
        const anchorXY = projection(GRATICULE_ANCHOR);
        ringCircles
            .attr("cx", anchorXY[0])
            .attr("cy", anchorXY[1])
            .attr("r", (km) => {
                const deg = km / EARTH_KM_PER_DEGREE;
                const edge = projection([GRATICULE_ANCHOR[0], GRATICULE_ANCHOR[1] + deg]);
                return Math.hypot(edge[0] - anchorXY[0], edge[1] - anchorXY[1]);
            });

        // Anchor crosshair — 8px horizontal and vertical ticks at center.
        const ch = crosshair.selectAll(".graticule__crosshair-line");
        ch.filter((_, i) => i === 0)
            .attr("x1", anchorXY[0] - 6).attr("y1", anchorXY[1])
            .attr("x2", anchorXY[0] + 6).attr("y2", anchorXY[1]);
        ch.filter((_, i) => i === 1)
            .attr("x1", anchorXY[0]).attr("y1", anchorXY[1] - 6)
            .attr("x2", anchorXY[0]).attr("y2", anchorXY[1] + 6);

        // Position label groups at each country's centroid + nudge.
        labelGroups.attr("transform", (d) => {
            const [lon, lat] = d3.geoCentroid(d);
            const [px, py] = projection([lon, lat]);
            const [nx, ny] = LABEL_NUDGE_PX[d.id] || [0, 0];
            return `translate(${px + nx}, ${py + ny})`;
        });

        labelGroups.select(".label__code").attr("y", -8);
        labelGroups.select(".label__price").attr("y", 10);

        // Cartouche — compass rose in the bottom-left corner, scale
        // bar above it. Positioned in absolute viewBox pixel coords so
        // it stays pinned regardless of resize. Scale bar pixel length
        // is recomputed from the current projection by measuring the
        // projected distance for SCALE_BAR_KM along the north meridian
        // at the anchor latitude — what the reader sees as "200 km"
        // is the same 200 km wherever they would measure it.
        const compassX = CARTOUCHE_MARGIN_X + COMPASS_RADIUS + 4;
        const compassY = clientHeight - CARTOUCHE_BOTTOM - COMPASS_RADIUS - 48;
        gCompass.attr("transform", `translate(${compassX}, ${compassY})`);

        const scaleDeg = SCALE_BAR_KM / EARTH_KM_PER_DEGREE;
        const scaleEdge = projection([
            GRATICULE_ANCHOR[0] + scaleDeg / Math.cos((GRATICULE_ANCHOR[1] * Math.PI) / 180),
            GRATICULE_ANCHOR[1],
        ]);
        const scaleAnchor = projection(GRATICULE_ANCHOR);
        const scaleLenPx = Math.max(
            40,
            Math.abs(scaleEdge[0] - scaleAnchor[0]),
        );
        const scaleX = CARTOUCHE_MARGIN_X + 4;
        const scaleY = clientHeight - CARTOUCHE_BOTTOM + 24;
        gScale.attr("transform", `translate(${scaleX}, ${scaleY})`);
        gScale.select(".cartouche__scale-bar")
            .attr("x1", 0).attr("x2", scaleLenPx);
        gScale.select(".cartouche__scale-tick:not(.cartouche__scale-tick--end):not(.cartouche__scale-tick--mid)")
            .attr("x1", 0).attr("x2", 0);
        gScale.select(".cartouche__scale-tick--end")
            .attr("x1", scaleLenPx).attr("x2", scaleLenPx);
        gScale.select(".cartouche__scale-tick--mid")
            .attr("x1", scaleLenPx / 2).attr("x2", scaleLenPx / 2);
        gScale.select(".cartouche__scale-label").attr("x", scaleLenPx / 2);
        gScale.select(".cartouche__scale-origin").attr("x", 0);
        gScale.select(".cartouche__scale-end").attr("x", scaleLenPx);

        // Edge labels — meridians pinned to the top inside-edge, parallels
        // to the right inside-edge. Use a small inset so they sit clear
        // of the scroll-progress bar and the HUD.
        const edgePad = 16;
        meridianLabels
            .attr("x", (lon) => projection([lon, GRATICULE_PARALLELS[GRATICULE_PARALLELS.length - 1]])[0])
            .attr("y", edgePad + 14);
        parallelLabels
            .attr("x", clientWidth - edgePad - 4)
            .attr("y", (lat) => projection([GRATICULE_MERIDIANS[GRATICULE_MERIDIANS.length - 1], lat])[1]);

        // Centroid cache used by the flow layer. Indexed by ISO code,
        // values are projected [x, y] in pixel space.
        centroidPx = new Map(
            countries.features.map((f) => {
                const [lon, lat] = d3.geoCentroid(f);
                return [f.id, projection([lon, lat])];
            }),
        );

        // If we have an active state, redraw the flows with the new
        // centroid positions after a resize.
        if (state.hour != null) drawFlows();
    }

    // Must be declared BEFORE the first resize() call because resize()
    // reads from `state` when deciding whether to redraw flows.
    const state = {
        hour: null,
        focusCountry: null,
    };

    // Populated on every resize; read by drawFlows().
    let centroidPx = new Map();

    // Particle pool keyed by flow id ("CH-DE" etc). Each entry carries
    // the measured path length, a focus flag, and an array of particle
    // state objects. The pool is rebuilt whenever drawFlows() runs so
    // count/speed/radius track the current spread and focus country.
    const particlePools = new Map();
    let particleRafId = null;
    let particleLastTs = null;

    /**
     * Render SVG flow arrows between every connected market pair with
     * a material price differential. Arrows go from low-price to
     * high-price (direction money would push electricity) with
     * thickness proportional to |spread|. Re-runs on every `update()`
     * and after resize.
     */
    function drawFlows() {
        if (state.hour == null || !showcase) return;

        const flows = [];
        for (const [a, b] of INTERCONNECTORS) {
            const pa = showcase.countries?.[a]?.[state.hour]?.price;
            const pb = showcase.countries?.[b]?.[state.hour]?.price;
            if (pa == null || pb == null) continue;
            const spread = Math.abs(pa - pb);
            if (spread < ARROW_SPREAD_THRESHOLD) continue;

            // Flow direction: money follows the gradient. Low price is
            // the source (oversupply), high price is the destination.
            const [fromIso, toIso] = pa < pb ? [a, b] : [b, a];
            const fromXY = centroidPx.get(fromIso);
            const toXY = centroidPx.get(toIso);
            if (!fromXY || !toXY) continue;

            // Highlight the strongest arrow touching the focus country.
            const touchesFocus =
                state.focusCountry != null &&
                (fromIso === state.focusCountry || toIso === state.focusCountry);

            flows.push({
                id: `${a}-${b}`,
                fromIso,
                toIso,
                fromXY,
                toXY,
                spread,
                touchesFocus,
            });
        }

        // Stable key so persistent arrows reuse the same DOM node and
        // morph smoothly instead of being destroyed and recreated.
        const selection = gFlows
            .selectAll("path.flow")
            .data(flows, (d) => d.id);

        // Transition duration matches the country fill transition so
        // colors, labels, and arrows all land together as one beat.
        const DUR = 800;
        const EASE = d3.easeCubicInOut;

        // Exit — collapse the arrow back to a degenerate dot at its
        // origin point, fading stroke-opacity over the same beat.
        // `d` is tweened via d3.interpolateString, so persistent
        // structure (M _ Q _ _) lets us land smoothly at the source.
        selection.exit()
            .transition().duration(DUR).ease(EASE)
            .attrTween("d", function (d) {
                const from = d3.select(this).attr("d");
                const collapsed = degeneratePath(d.fromXY);
                return d3.interpolateString(from, collapsed);
            })
            .attr("stroke-opacity", 0)
            .attr("stroke-width", 0)
            .remove();

        // Enter — new arrows start as a degenerate dot at the SOURCE
        // country with zero width and zero opacity. The shared merge
        // transition below then tweens `d` through d3's string
        // interpolator, producing a visible "growth" from source to
        // destination in the same 800ms beat.
        const enter = selection.enter()
            .append("path")
            .attr("class", "flow")
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("marker-end", "url(#flow-arrow-head)")
            .attr("stroke-opacity", 0)
            .attr("stroke-width", 0)
            .attr("d", (d) => degeneratePath(d.fromXY));

        // Merge — tween `d`, stroke-width, and stroke-opacity together
        // on the same curve. `attrTween` on `d` uses d3's string
        // interpolator which handles matching-structure paths cleanly.
        //
        // Note: the guide path is now a dim channel rather than the
        // marching-ants hero. The real motion lives in the particle
        // layer driven by syncParticlePools() below.
        enter.merge(selection)
            .classed("flow--focus", (d) => d.touchesFocus)
            .transition().duration(DUR).ease(EASE)
            .attrTween("d", function (d) {
                const from = d3.select(this).attr("d") || degeneratePath(d.fromXY);
                const to = flowPath(d.fromXY, d.toXY);
                return d3.interpolateString(from, to);
            })
            .attr("stroke-width", (d) => widthForSpread(d.spread) * 0.6)
            .attr("stroke-opacity", (d) => (d.touchesFocus ? 0.32 : 0.18));

        syncParticlePools(flows);
    }

    /**
     * Rebuild the particle pools so the set of active flows and the
     * density of each matches the current spread/focus state.
     *
     * Existing pools for flows that are still present are reused
     * (keeps their t-values so there's no visual reset), but their
     * target density/speed are refreshed. Flows that disappeared get
     * their DOM nodes removed. Flows that just appeared get a fresh
     * pool whose particles are initialized at staggered t values so
     * the stream doesn't clump at the origin.
     */
    function syncParticlePools(flows) {
        const nextIds = new Set(flows.map((f) => f.id));

        // Drop pools whose flow no longer exists this frame.
        for (const id of Array.from(particlePools.keys())) {
            if (!nextIds.has(id)) {
                const pool = particlePools.get(id);
                pool.group.remove();
                particlePools.delete(id);
            }
        }

        for (const flow of flows) {
            let pool = particlePools.get(flow.id);
            if (!pool) {
                // Create the guide-path measurement node (a hidden
                // SVG path sharing the same `d` as the visible flow
                // guide). We read totalLength() and getPointAtLength()
                // off this node rather than the visible one, so tween
                // transitions on the visible path never make particles
                // momentarily jump.
                const measure = document.createElementNS("http://www.w3.org/2000/svg", "path");
                measure.setAttribute("d", flowPath(flow.fromXY, flow.toXY));
                measure.setAttribute("fill", "none");
                measure.setAttribute("stroke", "none");
                // Measure path is NOT appended to DOM; getPointAtLength
                // still works on detached SVGPathElement in modern browsers.
                const group = gParticles.append("g").attr("class", "particle-group");
                pool = {
                    id: flow.id,
                    measure,
                    group,
                    length: measure.getTotalLength(),
                    particles: [],
                    touchesFocus: flow.touchesFocus,
                    spread: flow.spread,
                };
                particlePools.set(flow.id, pool);
            } else {
                // Refresh the measurement path so tweens land cleanly.
                pool.measure.setAttribute("d", flowPath(flow.fromXY, flow.toXY));
                pool.length = pool.measure.getTotalLength();
                pool.touchesFocus = flow.touchesFocus;
                pool.spread = flow.spread;
            }

            const targetCount = particleCountForSpread(flow.spread);
            resizeParticlePool(pool, targetCount);
        }

        ensureParticleLoop();
    }

    function resizeParticlePool(pool, targetCount) {
        // Grow: add new particles with staggered t so they enter
        // smoothly across the length rather than all from the source.
        while (pool.particles.length < targetCount) {
            const idx = pool.particles.length;
            const t = (idx / targetCount + Math.random() * 0.02) % 1;
            const circle = pool.group.append("circle")
                .attr("class", "particle")
                .attr("r", pool.touchesFocus ? PARTICLE_FOCUS_RADIUS : PARTICLE_BASE_RADIUS)
                .attr("cx", 0)
                .attr("cy", 0);
            if (pool.touchesFocus) circle.classed("particle--focus", true);
            pool.particles.push({ t, circle });
        }
        // Shrink: drop trailing circles (they'll recycle on next spread).
        while (pool.particles.length > targetCount) {
            const p = pool.particles.pop();
            p.circle.remove();
        }
        // Refresh radius + class on kept particles in case focus toggled.
        pool.particles.forEach((p) => {
            p.circle
                .attr("r", pool.touchesFocus ? PARTICLE_FOCUS_RADIUS : PARTICLE_BASE_RADIUS)
                .classed("particle--focus", pool.touchesFocus);
        });
    }

    function ensureParticleLoop() {
        if (particleRafId != null) return;
        particleLastTs = null;
        const tick = (ts) => {
            if (particleLastTs == null) particleLastTs = ts;
            const dt = Math.min(64, ts - particleLastTs);
            particleLastTs = ts;

            for (const pool of particlePools.values()) {
                if (!pool.length) continue;
                const speed = pool.touchesFocus
                    ? PARTICLE_FOCUS_SPEED
                    : PARTICLE_BASE_SPEED;
                for (const p of pool.particles) {
                    p.t += dt * speed;
                    if (p.t >= 1) p.t -= 1;
                    // Fade in at t~0, peak mid-path, fade out near t~1.
                    // sin(pi * t) gives a clean 0→1→0 envelope.
                    const envelope = Math.sin(Math.PI * p.t);
                    const pt = pool.measure.getPointAtLength(p.t * pool.length);
                    p.circle
                        .attr("cx", pt.x)
                        .attr("cy", pt.y)
                        .attr("opacity", envelope);
                }
            }

            if (particlePools.size === 0) {
                particleRafId = null;
                return;
            }
            particleRafId = requestAnimationFrame(tick);
        };
        particleRafId = requestAnimationFrame(tick);
    }

    function particleCountForSpread(spread) {
        const t = Math.min(1, Math.max(0, spread / ARROW_WIDTH_PIVOT));
        return Math.round(
            PARTICLE_MIN_COUNT + t * (PARTICLE_MAX_COUNT - PARTICLE_MIN_COUNT),
        );
    }

    resize();
    window.addEventListener("resize", resize);

    /**
     * Update the map state to a specific hour on the showcase day,
     * optionally with a "focus country" that receives a larger,
     * glowing label treatment (the card's target country).
     *
     * Accepts:
     *   { hour: 13, focusCountry: "CH" }   — apply prices + focus
     *   { hour: null }                      — reset to base (dark) state
     */
    function update(next) {
        Object.assign(state, next);

        // Fill each country with its price color at the current hour.
        if (state.hour == null || !showcase) {
            // Reset — base state, no colors, no labels, no flows.
            countryPaths
                .interrupt()
                .attr("fill", null)
                .classed("is-focus-country", false);
            labelGroups.classed("is-visible", false).classed("is-focus", false);
            gFlows.selectAll("path.flow").remove();
            // Tear the particle pools down — the rAF loop self-halts
            // when the pool map is empty.
            for (const pool of particlePools.values()) pool.group.remove();
            particlePools.clear();
            return;
        }

        // Highlight the focus country's own shape so the 3D-tilt CSS
        // layer can lift it forward. `is-focus-country` is also used
        // by the focus-target drop-shadow in the map CSS.
        countryPaths.classed(
            "is-focus-country",
            (d) => d.id === state.focusCountry,
        );

        labelGroups.classed("is-visible", true);

        // Country fills share duration AND easing with the flow-arrow
        // transition below so the whole beat lands in unison.
        countryPaths
            .transition()
            .duration(800)
            .ease(d3.easeCubicInOut)
            .attr("fill", (d) => {
                const entry = showcase.countries?.[d.id]?.[state.hour];
                return entry ? priceColor(entry.price) : null;
            });

        // Update label text + focus state. The focus country gets the
        // large "hero number" treatment — other countries stay compact.
        labelGroups.each(function (d) {
            const entry = showcase.countries?.[d.id]?.[state.hour];
            const g = d3.select(this);
            g.classed("is-focus", d.id === state.focusCountry);
            if (!entry) {
                g.select(".label__price").text("—");
                return;
            }
            g.select(".label__price").text(formatPrice(entry.price));
        });

        drawFlows();
    }

    /**
     * Project a country's centroid to viewport coordinates.
     * Used by narrative.js to draw leader lines from card edges to
     * the country a step is talking about.
     */
    function getCountryCentroidPx(iso) {
        const feature = countries.features.find((f) => f.id === iso);
        if (!feature) return null;
        // d3.geoCentroid → [lon, lat]; project to pixel space.
        const [lon, lat] = d3.geoCentroid(feature);
        const px = projection([lon, lat]);
        if (!px) return null;
        // The container is position:fixed, so its rect is in viewport coords.
        const rect = container.getBoundingClientRect();
        return { x: rect.left + px[0], y: rect.top + px[1] };
    }

    function destroy() {
        window.removeEventListener("resize", resize);
        if (particleRafId != null) cancelAnimationFrame(particleRafId);
        particleRafId = null;
        particlePools.clear();
        svg.remove();
    }

    return { update, destroy, getCountryCentroidPx };
}

/**
 * Format a price as a JetBrains Mono-friendly string with a true
 * Unicode minus (U+2212) for negatives. Produces compact values like
 * "€45" for positives, "−€145" for negatives.
 */
function formatPrice(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const rounded = Math.round(value);
    if (rounded < 0) {
        return `\u2212€${Math.abs(rounded)}`;
    }
    return `€${rounded}`;
}

/**
 * Build a curved SVG path from one country's centroid to another's.
 *
 * Two-endpoint quadratic bezier whose control point sits perpendicular
 * to the midpoint at 18% of the segment length, biased to the left so
 * opposing flows (A→B and B→A are never both drawn, but adjacent pairs
 * like CH→IT and AT→IT never overlap).
 *
 * Start and end points are inset by an "anchor gap" so the arrow does
 * not visually collide with the price label at the centroid.
 */
function flowPath([x1, y1], [x2, y2]) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return "";

    // Inset both endpoints by a fixed gap (in pixels) along the line.
    const GAP = 28;
    const ux = dx / len;
    const uy = dy / len;
    const sx = x1 + ux * GAP;
    const sy = y1 + uy * GAP;
    const ex = x2 - ux * GAP;
    const ey = y2 - uy * GAP;

    // Perpendicular control point — curves the arrow to the left of the
    // direction of travel. Curvature is a fraction of segment length.
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const CURVATURE = 0.18;
    const cx = mx + -uy * len * CURVATURE;
    const cy = my + ux * len * CURVATURE;

    return `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`;
}

/**
 * Map |price spread| in EUR/MWh to a pixel stroke width. Clamped to
 * the ARROW_MIN_WIDTH / ARROW_MAX_WIDTH range.
 */
function widthForSpread(spread) {
    const t = Math.min(1, Math.max(0, spread / ARROW_WIDTH_PIVOT));
    return ARROW_MIN_WIDTH + t * (ARROW_MAX_WIDTH - ARROW_MIN_WIDTH);
}

/**
 * A zero-length path collapsed to a single point. Used as the start
 * state for entering flow arrows and the end state for exiting ones
 * so the `d` attribute can be tweened via d3.interpolateString
 * through a path of matching structure (`M x,y Q x,y x,y`).
 */
function degeneratePath([x, y]) {
    return `M${x},${y} Q${x},${y} ${x},${y}`;
}
