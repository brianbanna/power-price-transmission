import { createMap } from "./map.js";
import { initNarrative } from "./narrative.js";
import { loadJSON } from "./utils/data.js";

// Entry point. Wires the map and the scrollytelling narrative together
// once the DOM is ready. Individual modules are responsible for their
// own rendering; this file only coordinates their lifecycle.

async function init() {
    const [topology, showcase] = await Promise.all([
        loadJSON("map.topojson"),
        loadJSON("showcase_day.json"),
    ]);

    const map = createMap("#map-container", { topology });
    initNarrative("#narrative", { map, showcase });

    console.info("HSquareB initialized");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
