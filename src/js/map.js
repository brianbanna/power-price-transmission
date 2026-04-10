// Map module — renders the five-country topology and exposes a tiny
// controller surface (`update`, `destroy`) the rest of the app uses to
// drive state changes during scroll.
//
// Task 2.2 pivot: this pulls forward the basic topology render from
// Task 3.1 so the map-dominant layout does not expose a full-viewport
// black rectangle. Colors, arrows, and labels land in Tasks 3.3–3.9.

import * as d3 from "d3";
import * as topojson from "topojson-client";

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

export function createMap(selector, config) {
    const container = document.querySelector(selector);
    if (!container) {
        throw new Error(`createMap: no element matches ${selector}`);
    }

    const { topology } = config;
    const countries = topojson.feature(topology, topology.objects.countries);

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

    // Layer order matters: graticule first so countries paint on top.
    const gGraticule = svg.append("g").attr("class", "graticule");
    const gRings = svg.append("g").attr("class", "graticule__rings");
    const gCountries = svg.append("g").attr("class", "countries");

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
    }

    resize();
    window.addEventListener("resize", resize);

    // Controller surface used by narrative.js and explorer.js.
    const state = {
        currentHour: null,
        showcase: null,
    };

    function update(next) {
        Object.assign(state, next);
        // Color fills, flow arrows, and labels land in Tasks 3.3–3.9.
    }

    function destroy() {
        window.removeEventListener("resize", resize);
        svg.remove();
    }

    return { update, destroy };
}
