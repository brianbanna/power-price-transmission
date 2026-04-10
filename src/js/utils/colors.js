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

export const GENERATION_COLORS = {
    solar:   "#fbbf24",
    wind:    "#10b981",
    nuclear: "#a855f7",
    hydro:   "#6366f1",
    biomass: "#84cc16",
    gas:     "#f97316",
    coal:    "#64748b",
};
