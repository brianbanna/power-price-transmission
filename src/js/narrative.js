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
const LEADER_OVERLAY_SELECTOR = "#leader-overlay";
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
    const leaderOverlay = document.querySelector(LEADER_OVERLAY_SELECTOR);

    // Set up the leader-line overlay if the map exposes centroid lookup.
    const leaderCtl = (leaderOverlay && config.map?.getCountryCentroidPx)
        ? createLeaderController(leaderOverlay, config.map)
        : null;

    // Render a small sparkline inside each step card, showing the full
    // 24-hour price trajectory of that step's focus country with the
    // current hour highlighted.
    if (config.showcase) {
        steps.forEach((step) => renderStepSparkline(step, config.showcase));
    }

    // One-shot flag for the zero-crossing sweep.
    let zeroCrossFired = false;
    const triggerZeroCrossSweep = () => {
        const line = document.createElement("div");
        line.className = "zero-cross-sweep";
        document.body.appendChild(line);
        document.body.classList.add("is-zero-crossing");
        setTimeout(() => {
            line.remove();
            document.body.classList.remove("is-zero-crossing");
        }, 1100);
    };

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

            // Zero-crossing sweep — fires exactly once, the first time
            // the reader reaches the shock step (data-step="3").
            if (element.dataset.step === "3" && !zeroCrossFired) {
                zeroCrossFired = true;
                triggerZeroCrossSweep();
            }

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

            // Draw a leader line from the active card to its target country.
            if (leaderCtl) {
                leaderCtl.show(element);
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
                if (leaderCtl) leaderCtl.hide();
                if (config.map && typeof config.map.update === "function") {
                    config.map.update({ activeStep: null });
                }
            }

            // When scrolling DOWN past the last step, release the
            // desaturation so the explorer below gets a vivid map.
            if (direction === "down" && element === steps[steps.length - 1]) {
                document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
                if (leaderCtl) leaderCtl.hide();
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
    // viewport changes or when fonts load in and shift layout. The
    // leader line also needs to redraw because card and country
    // positions both depend on viewport geometry.
    const onResize = () => {
        scroller.resize();
        if (leaderCtl) leaderCtl.redraw();
    };
    window.addEventListener("resize", onResize);
    document.fonts?.ready?.then(() => {
        scroller.resize();
        if (leaderCtl) leaderCtl.redraw();
    });

    // The cards translate as the page scrolls, so the leader line's
    // origin point shifts continuously. Cheap rAF redraw on scroll.
    if (leaderCtl) {
        let leaderTicking = false;
        window.addEventListener("scroll", () => {
            if (leaderTicking) return;
            leaderTicking = true;
            requestAnimationFrame(() => {
                leaderCtl.redraw();
                leaderTicking = false;
            });
        }, { passive: true });
    }

    return {
        steps,
        scroller,
    };
}


/**
 * Leader line controller — draws an SVG path from the active narrative
 * card to the centroid of the country the step is talking about.
 *
 * The line is a two-segment elbow: horizontal from the card edge then
 * diagonal to the target. A glowing dot + pulsing ring mark the target.
 * On step exit the elements fade out; the rAF scroll loop in the
 * caller keeps the geometry in sync as the card translates.
 */
function createLeaderController(svgEl, mapCtl) {
    const NS = "http://www.w3.org/2000/svg";
    const line = document.createElementNS(NS, "path");
    line.setAttribute("class", "leader-line");
    const target = document.createElementNS(NS, "circle");
    target.setAttribute("class", "leader-target");
    target.setAttribute("r", "3");
    const pulse = document.createElementNS(NS, "circle");
    pulse.setAttribute("class", "leader-target-pulse");
    pulse.setAttribute("r", "4");

    svgEl.append(line, pulse, target);

    let activeStep = null;

    function show(stepEl) {
        activeStep = stepEl;
        line.classList.add("is-visible");
        target.classList.add("is-visible");
        pulse.classList.add("is-pulsing");
        redraw();
    }

    function hide() {
        activeStep = null;
        line.classList.remove("is-visible");
        target.classList.remove("is-visible");
        pulse.classList.remove("is-pulsing");
    }

    function redraw() {
        if (!activeStep) return;
        const iso = activeStep.dataset.country;
        if (!iso) return;
        const dest = mapCtl.getCountryCentroidPx(iso);
        if (!dest) return;

        // Compute the leader's start: the right edge of the active card,
        // vertically centered on the headline.
        const cardRect = activeStep.getBoundingClientRect();
        const headline = activeStep.querySelector(".step__headline");
        const yAnchor = headline
            ? headline.getBoundingClientRect().top + headline.offsetHeight / 2
            : cardRect.top + cardRect.height * 0.4;
        const startX = cardRect.right + 8;
        const startY = yAnchor;

        // Bail if the card is off-screen — leader is meaningless then.
        if (cardRect.right < 0 || cardRect.left > window.innerWidth) {
            line.classList.remove("is-visible");
            target.classList.remove("is-visible");
            pulse.classList.remove("is-pulsing");
            return;
        } else if (activeStep) {
            line.classList.add("is-visible");
            target.classList.add("is-visible");
            pulse.classList.add("is-pulsing");
        }

        // Two-segment elbow: horizontal stub from the card, then diagonal
        // to the target. Stub length scales with horizontal distance.
        const stubLen = Math.min(48, Math.max(16, (dest.x - startX) * 0.18));
        const elbowX = startX + stubLen;
        const d = `M${startX},${startY} L${elbowX},${startY} L${dest.x - 6},${dest.y}`;
        line.setAttribute("d", d);

        target.setAttribute("cx", dest.x);
        target.setAttribute("cy", dest.y);
        pulse.setAttribute("cx", dest.x);
        pulse.setAttribute("cy", dest.y);
    }

    return { show, hide, redraw };
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
