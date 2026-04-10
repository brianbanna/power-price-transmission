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

    const projection = d3
        .geoConicConformal()
        .center(PROJECTION_CONFIG.center)
        .rotate(PROJECTION_CONFIG.rotate)
        .parallels(PROJECTION_CONFIG.parallels);

    const pathGen = d3.geoPath(projection);

    // Layer order matters: graticule → countries → labels, top to bottom.
    const gGraticule = svg.append("g").attr("class", "graticule");
    const gRings = svg.append("g").attr("class", "graticule__rings");
    const gCountries = svg.append("g").attr("class", "countries");
    const gLabels = svg.append("g").attr("class", "labels");

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
        const { clientWidth, clientHeight } = container;
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
    }

    resize();
    window.addEventListener("resize", resize);

    // Controller surface used by narrative.js and explorer.js.
    const state = {
        hour: null,
        focusCountry: null,
    };

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
            // Reset — base state, no colors, no labels.
            // Kill any in-flight color transition and clear the
            // presentation attribute so the CSS default fill wins.
            countryPaths.interrupt().attr("fill", null);
            labelGroups.classed("is-visible", false).classed("is-focus", false);
            return;
        }

        labelGroups.classed("is-visible", true);

        countryPaths
            .transition()
            .duration(800)
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
