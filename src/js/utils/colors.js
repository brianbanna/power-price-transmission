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
            .domain([-200, -100, -50, 0, 40, 75, 150, 300])
            .range([
                "#e0f7ff",   // ice-white extreme negative
                "#67e8f9",   // bright cyan
                "#22d3ee",   // accent cyan
                "#0e7490",   // dark cyan (zero-crossing, negative side)
                "#78716c",   // warm stone (baseline ~40 EUR)
                "#e8a460",   // warm amber (visible from ~75 EUR)
                "#ef4444",   // red (expensive)
                "#991b1b",   // deep red
            ])
            .interpolate(interpolateRgb)
            .clamp(true);
    }
    return _continuousScale(price);
}

// Renewable share scale — green gradient from 0% to 100%.
let _renewableScale = null;

export function renewableColor(share) {
    if (share == null || Number.isNaN(share)) return "#1c2235";
    if (!_renewableScale) {
        const { scaleLinear, interpolateRgb } = window.d3 || {};
        if (!scaleLinear) return "#10b981";
        _renewableScale = scaleLinear()
            .domain([0, 0.3, 0.6, 1.0])
            .range(["#1e293b", "#065f46", "#10b981", "#6ee7b7"])
            .interpolate(interpolateRgb)
            .clamp(true);
    }
    return _renewableScale(share);
}

export const GENERATION_COLORS = {
    solar:   "#fbbf24",
    wind:    "#34d399",   // emerald — shifted from #10b981 to avoid accent-cyan confusion under desaturation
    nuclear: "#a855f7",
    hydro:   "#6366f1",
    biomass: "#84cc16",
    gas:     "#f59e0b",   // amber — shifted from #f97316 to separate from price-positive orange
    coal:    "#64748b",
};
