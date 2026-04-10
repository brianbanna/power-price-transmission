// Narrative scroll orchestration.
//
// Uses Scrollama to detect which narrative step is currently in view.
// When a step enters the active zone, we:
//   1. Toggle `.is-active` on the card (CSS handles the visual reveal)
//   2. Notify the map controller so it can react (colors, flows, labels)
//   3. Update the HUD timestamp / meta so the reader always knows which
//      moment they are looking at.
//
// The "active zone" is ~55% from the top of the viewport — the card
// needs to scroll just past the middle before it lights up, which
// matches the pace of reading rather than pure geometry.

import scrollama from "scrollama";

const ACTIVE_OFFSET = 0.55;
const HUD_PROGRESS_SELECTOR = "[data-hud-timestamp]";
const HUD_META_SELECTOR = "[data-hud-meta]";
const PROGRESS_BAR_SELECTOR = ".scroll-progress__bar";
const HUD_SELECTOR = ".hud";

export function initNarrative(selector, config) {
    const container = document.querySelector(selector);
    if (!container) {
        throw new Error(`initNarrative: no element matches ${selector}`);
    }

    const steps = Array.from(container.querySelectorAll(".step"));
    if (steps.length === 0) {
        console.warn("initNarrative: no .step elements found inside", selector);
        return { steps: [] };
    }

    const hud = document.querySelector(HUD_SELECTOR);
    const hudTimestamp = document.querySelector(HUD_PROGRESS_SELECTOR);
    const hudMeta = document.querySelector(HUD_META_SELECTOR);
    const progressBar = document.querySelector(PROGRESS_BAR_SELECTOR);

    const scroller = scrollama();
    scroller
        .setup({
            step: steps,
            offset: ACTIVE_OFFSET,
            progress: false,
        })
        .onStepEnter(({ element, index }) => {
            // Mark the active step and clear any previously active.
            steps.forEach((s) => s.classList.toggle("is-active", s === element));

            // Update the HUD with this step's metadata.
            if (hud && hud.classList.contains("is-visible") === false) {
                hud.classList.add("is-visible");
            }
            if (hudTimestamp) {
                hudTimestamp.textContent = element.dataset.timestamp || "—";
            }
            if (hudMeta) {
                hudMeta.textContent = element.dataset.meta || "";
            }

            // Push state to the map so colors / arrows / labels can react.
            if (config.map && typeof config.map.update === "function") {
                config.map.update({
                    activeStep: Number(element.dataset.step) || index + 1,
                    timestamp: element.dataset.timestamp,
                });
            }
        })
        .onStepExit(({ element, direction }) => {
            // When scrolling UP past the first step, hide the HUD again.
            if (direction === "up" && element === steps[0]) {
                element.classList.remove("is-active");
                if (hud) hud.classList.remove("is-visible");
                if (config.map && typeof config.map.update === "function") {
                    config.map.update({ activeStep: null });
                }
            }
        });

    // Global scroll progress → the 2px bar at the top of the viewport.
    if (progressBar) {
        const updateProgress = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            if (max <= 0) return;
            const pct = Math.min(100, Math.max(0, (window.scrollY / max) * 100));
            progressBar.style.width = `${pct}%`;
        };
        updateProgress();
        window.addEventListener("scroll", updateProgress, { passive: true });
    }

    // Resize handling — scrollama needs to recompute offsets when the
    // viewport changes or when fonts load in and shift layout.
    window.addEventListener("resize", () => scroller.resize());
    document.fonts?.ready?.then(() => scroller.resize());

    return {
        steps,
        scroller,
    };
}
