// Color tokens from the locked design system.
// Any change here must also update `src/css/style.css` `:root` variables
// and vice versa — keep the two in sync.

export const PRICE_STOPS = [
    { max: -100, color: "#e0f7ff" },   // ice-white glow — peak drama
    { max: -50,  color: "#67e8f9" },   // bright cyan
    { max: 0,    color: "#22d3ee" },   // accent cyan
    { max: 50,   color: "#475569" },   // neutral slate — boring baseline
    { max: 100,  color: "#fb923c" },   // muted orange
    { max: 200,  color: "#ef4444" },   // red
    { max: Infinity, color: "#991b1b" }, // deep red
];

export function priceColor(price) {
    if (price == null || Number.isNaN(price)) return "#1c2235";
    for (const stop of PRICE_STOPS) {
        if (price < stop.max) return stop.color;
    }
    return PRICE_STOPS[PRICE_STOPS.length - 1].color;
}

// Continuous interpolated price scale — for dense grids (calendar
// heatmaps) where the stepped priceColor produces visible banding.
// Uses the same semantic endpoints as PRICE_STOPS but interpolates
// between them via d3.scaleLinear + d3.interpolateRgb. Import d3
// lazily to keep this file synchronous for other consumers.
let _continuousScale = null;

export function priceContinuous(price) {
    if (price == null || Number.isNaN(price)) return "#1c2235";
    if (!_continuousScale) {
        // Defer d3 import until first call — avoids import-order
        // issues with the static ESM import map.
        const { scaleLinear, interpolateRgb } = window.d3 || {};
        if (!scaleLinear) return priceColor(price); // fallback
        _continuousScale = scaleLinear()
            .domain([-200, -100, -50, 0, 50, 100, 200, 400])
            .range([
                "#e0f7ff",   // ice-white extreme
                "#67e8f9",   // bright cyan
                "#22d3ee",   // accent cyan
                "#0e7490",   // dark cyan (zero-crossing)
                "#475569",   // neutral slate
                "#fb923c",   // muted orange
                "#ef4444",   // red
                "#991b1b",   // deep red
            ])
            .interpolate(interpolateRgb)
            .clamp(true);
    }
    return _continuousScale(price);
}

export const GENERATION_COLORS = {
    solar:   "#fbbf24",
    wind:    "#10b981",
    nuclear: "#a855f7",
    hydro:   "#6366f1",
    biomass: "#84cc16",
    gas:     "#f97316",
    coal:    "#64748b",
};
