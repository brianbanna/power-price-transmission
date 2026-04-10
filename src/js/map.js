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
const FIT_PADDING = 32;

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

    const gCountries = svg.append("g").attr("class", "countries");

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
