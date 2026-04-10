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

import * as d3 from "d3";
import scrollama from "scrollama";

const ACTIVE_OFFSET = 0.55;
const HUD_PROGRESS_SELECTOR = "[data-hud-timestamp]";
const HUD_META_SELECTOR = "[data-hud-meta]";
const PROGRESS_BAR_SELECTOR = ".scroll-progress__bar";
const PROGRESS_TICKS_SELECTOR = "[data-progress-ticks]";
const HUD_SELECTOR = ".hud";
const NARRATIVE_ACTIVE_CLASS = "is-narrative-active";

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
    const progressTicks = document.querySelector(PROGRESS_TICKS_SELECTOR);

    // Render a small sparkline inside each step card, showing the full
    // 24-hour price trajectory of that step's focus country with the
    // current hour highlighted.
    if (config.showcase) {
        steps.forEach((step) => renderStepSparkline(step, config.showcase));
    }

    // Render chapter ticks on the progress bar — one per step, positioned
    // at the scroll fraction corresponding to that step's centre.
    if (progressTicks && steps.length > 1) {
        progressTicks.replaceChildren();
        const layoutTicks = () => {
            progressTicks.replaceChildren();
            const max = document.documentElement.scrollHeight - window.innerHeight;
            if (max <= 0) return;
            steps.forEach((step) => {
                const rect = step.getBoundingClientRect();
                const absoluteTop = window.scrollY + rect.top + rect.height / 2;
                const trigger = absoluteTop - window.innerHeight * ACTIVE_OFFSET;
                const pct = Math.min(100, Math.max(0, (trigger / max) * 100));
                const tick = document.createElement("span");
                tick.className = "scroll-progress__tick";
                tick.style.left = `${pct}%`;
                progressTicks.appendChild(tick);
            });
        };
        layoutTicks();
        window.addEventListener("resize", layoutTicks);
        document.fonts?.ready?.then(layoutTicks);
    }

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

            // Tell the map to desaturate — the CSS rule on the map SVG
            // filter reacts to this class on <body>.
            document.body.classList.add(NARRATIVE_ACTIVE_CLASS);

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
            // When scrolling UP past the first step, hide the HUD again
            // and re-saturate the map.
            if (direction === "up" && element === steps[0]) {
                element.classList.remove("is-active");
                document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
                if (hud) hud.classList.remove("is-visible");
                if (config.map && typeof config.map.update === "function") {
                    config.map.update({ activeStep: null });
                }
            }

            // When scrolling DOWN past the last step, release the
            // desaturation so the explorer below gets a vivid map.
            if (direction === "down" && element === steps[steps.length - 1]) {
                document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
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


/**
 * Render an in-card sparkline of the showcase day's hourly price curve
 * for the step's focus country, with a filled zero line, the current
 * hour highlighted as a bright dot, and the labelled endpoints.
 *
 * The chart is 100% intentional visual — it serves two roles:
 *   1. gives the reader peripheral context ("you are HERE in a 24h arc")
 *   2. previews the dramatic drop that the story is about to tell
 */
function renderStepSparkline(stepEl, showcase) {
    const target = stepEl.querySelector("[data-step-chart]");
    if (!target) return;

    const country = stepEl.dataset.country || "CH";
    const focusHour = Number(stepEl.dataset.hour ?? 0);
    const series = showcase?.countries?.[country];
    if (!series || !Array.isArray(series) || series.length === 0) return;

    const width = 384;
    const height = 48;
    const padding = { top: 6, right: 6, bottom: 14, left: 6 };

    const x = d3.scaleLinear().domain([0, 23]).range([padding.left, width - padding.right]);
    const yExtent = d3.extent(series, (d) => d.price);
    // Pad the y range so extremes don't graze the top/bottom edges.
    const yPad = Math.max(10, (yExtent[1] - yExtent[0]) * 0.08);
    const y = d3
        .scaleLinear()
        .domain([yExtent[0] - yPad, Math.max(yExtent[1] + yPad, 0)])
        .range([height - padding.bottom, padding.top]);

    const svg = d3
        .select(target)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "none")
        .attr("class", "spark");

    // Zero line — a dashed reference for the price-negative threshold.
    if (y.domain()[0] < 0) {
        svg.append("line")
            .attr("class", "spark__zero")
            .attr("x1", padding.left)
            .attr("x2", width - padding.right)
            .attr("y1", y(0))
            .attr("y2", y(0));
    }

    // Area fill under the curve — a gradient that leans cyan when the
    // trace dives below zero.
    const areaGen = d3
        .area()
        .x((d) => x(d.hour))
        .y0(() => y(Math.max(y.domain()[0], Math.min(0, y.domain()[1]))))
        .y1((d) => y(d.price))
        .curve(d3.curveMonotoneX);

    svg.append("path")
        .datum(series)
        .attr("class", "spark__area")
        .attr("d", areaGen);

    // Line — the actual trajectory.
    const lineGen = d3
        .line()
        .x((d) => x(d.hour))
        .y((d) => y(d.price))
        .curve(d3.curveMonotoneX);

    svg.append("path")
        .datum(series)
        .attr("class", "spark__line")
        .attr("d", lineGen);

    // Focus marker — the current hour, rendered as a glowing dot.
    const focusPoint = series[focusHour];
    if (focusPoint) {
        const fx = x(focusPoint.hour);
        const fy = y(focusPoint.price);
        // Vertical indicator rule dropped from the dot down to the x-axis
        svg.append("line")
            .attr("class", "spark__indicator")
            .attr("x1", fx).attr("x2", fx)
            .attr("y1", fy).attr("y2", height - padding.bottom);
        svg.append("circle")
            .attr("class", "spark__dot")
            .attr("cx", fx).attr("cy", fy).attr("r", 3.5);
    }

    // Axis anchors — just the 00 and 23 hour labels for context, no ticks.
    svg.append("text")
        .attr("class", "spark__anchor")
        .attr("x", padding.left).attr("y", height - 2)
        .attr("text-anchor", "start")
        .text("00");
    svg.append("text")
        .attr("class", "spark__anchor")
        .attr("x", width - padding.right).attr("y", height - 2)
        .attr("text-anchor", "end")
        .text("23");
    // Country label on the left edge, near the top of the card's chart
    svg.append("text")
        .attr("class", "spark__country")
        .attr("x", padding.left)
        .attr("y", padding.top + 7)
        .attr("text-anchor", "start")
        .text(country);
}
