// Narrative scroll orchestration.
//
// Uses Scrollama to detect which narrative step is currently in view.
// When a step enters the active zone, we:
//   1. Toggle `.is-active` on the card (CSS handles the visual reveal)
//   2. Notify the map controller so it can react (colors, flows, labels)
//   3. Update the HUD timestamp / meta so the reader always knows which
//      moment they are looking at.
//
// The "active zone" is 80% from the top of the viewport — the card
// fires as soon as it's risen to 20% above the bottom edge. This
// lights the map up earlier in the reader's field of view so the
// colours never feel lagged behind the prose.

import * as d3 from "d3";
import scrollama from "scrollama";
import { createCalendarHeatmap } from "./charts/calendar_heatmap.js";
import { createGenerationStack } from "./charts/generation_stack.js";
import { createDailyProfile } from "./charts/daily_profile.js";

const ACTIVE_OFFSET = 0.80;
const HUD_PROGRESS_SELECTOR = "[data-hud-timestamp]";
const HUD_META_SELECTOR = "[data-hud-meta]";
const PROGRESS_BAR_SELECTOR = ".scroll-progress__bar";
const PROGRESS_TICKS_SELECTOR = "[data-progress-ticks]";
const HUD_SELECTOR = ".hud";
const LEADER_OVERLAY_SELECTOR = "#leader-overlay";
const MAP_CLOCK_SELECTOR = "[data-map-clock]";
const CLOCK_HOUR_SELECTOR = "[data-clock-hour]";
const CLOCK_DATE_SELECTOR = "[data-clock-date]";
const NARRATIVE_ACTIVE_CLASS = "is-narrative-active";
const PEAK_HOUR = 13;  // Step 3 trough — clock gets accent-glow treatment

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
    const mapClock = document.querySelector(MAP_CLOCK_SELECTOR);
    const clockHour = document.querySelector(CLOCK_HOUR_SELECTOR);
    const clockDate = document.querySelector(CLOCK_DATE_SELECTOR);

    // Set up the leader-line overlay if the map exposes centroid lookup.
    const leaderCtl = (leaderOverlay && config.map?.getCountryCentroidPx)
        ? createLeaderController(leaderOverlay, config.map)
        : null;

    // Render a small sparkline inside each step card, showing the full
    // 24-hour price trajectory of that step's focus country with the
    // current hour highlighted.
    if (config.showcase) {
        steps.forEach((step) => renderStepSparkline(step, config.showcase));
        // Step 2 gets a small generation-mix donut for Germany at hour 10
        // showing solar dominance. Rendered inside the same chart container
        // as the sparkline, floated to the right.
        const step2 = container.querySelector('[data-step="2"]');
        if (step2) {
            renderGenDonut(step2, config.showcase, "DE", 10);
        }
    }

    // Step 4 gets a calendar heatmap with a DE/CH toggle. Loaded
    // lazily — the data may arrive after init via injectCalendarHeatmap.
    const heatmapContainer = container.querySelector('[data-step-chart="heatmap"]');
    function injectCalendarHeatmap(calendarData) {
        if (!heatmapContainer || !calendarData?.days?.length) return;
        createCalendarHeatmap(heatmapContainer, {
            data: calendarData,
            countries: [
                { code: "DE", label: "Germany — 846 negative hours" },
                { code: "CH", label: "Switzerland — 529 negative hours" },
            ],
        });
    }
    if (config.calendarData) {
        injectCalendarHeatmap(config.calendarData);
    }

    // Step 5 gets a generation stack chart for Germany on the showcase
    // day. The reveal animation fires when the step enters the active
    // zone, so the stack sweeps open left-to-right as the reader
    // arrives at the card.
    let genStackCtl = null;
    if (config.showcase) {
        const genContainer = container.querySelector('[data-step-chart="genstack"]');
        if (genContainer) {
            const deSeries = config.showcase.countries?.DE;
            if (deSeries) {
                genStackCtl = createGenerationStack(genContainer, {
                    series: deSeries,
                    country: "DE",
                    label: "Germany — 12 May 2024",
                });
            }
        }
    }

    // Step 6 — duck curve: Germany's daily profile animated month by
    // month. The ghost line shows the annual average while the active
    // line morphs through each month's shape, revealing the deepening
    // midday dip.
    let duckCtl = null;
    if (config.profilesData?.countries?.DE) {
        const duckContainer = container.querySelector('[data-step-chart="duck"]');
        if (duckContainer) {
            duckCtl = createDailyProfile(duckContainer, {
                profiles: config.profilesData.countries.DE,
                country: "DE",
                label: "Germany — monthly price profile",
            });
        }
    }

    // Step 7 — small multiples: compact daily profiles for all 5
    // countries, showing their annual-average shape side by side.
    if (config.profilesData?.countries) {
        const multiContainer = container.querySelector('[data-step-chart="multiples"]');
        if (multiContainer) {
            const multiWrap = document.createElement("div");
            multiWrap.className = "small-multiples";
            for (const [code, lbl] of [
                ["DE", "Germany"], ["FR", "France"], ["CH", "Switzerland"],
                ["AT", "Austria"], ["IT", "Italy"],
            ]) {
                const profiles = config.profilesData.countries[code];
                if (profiles) {
                    createDailyProfile(multiWrap, {
                        profiles,
                        country: code,
                        label: lbl,
                        compact: true,
                    });
                }
            }
            multiContainer.appendChild(multiWrap);
        }
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

            // Update the big on-map clock. Parses the step's data-hour
            // and data-timestamp to populate the display-sized digits,
            // animates the digit reveal via a re-triggered CSS animation
            // on class toggle, and flags the peak-hour state so the
            // digits glow ice-white at the moment of the shock.
            if (mapClock) {
                mapClock.classList.add("is-visible");
                const hour = Number(element.dataset.hour);
                const isPeak = hour === PEAK_HOUR;
                mapClock.classList.toggle("is-peak", isPeak);
                if (clockHour && Number.isFinite(hour)) {
                    // Trigger the CSS keyframe on every change by
                    // removing and re-adding the animation via a reflow.
                    clockHour.textContent = String(hour).padStart(2, "0");
                    clockHour.style.animation = "none";
                    void clockHour.offsetWidth;
                    clockHour.style.animation = "";
                }
                if (clockDate && element.dataset.timestamp) {
                    // Extract the date portion from "2024-05-12 13:00 CET"
                    const datePart = element.dataset.timestamp.split(" ")[0];
                    if (datePart) {
                        clockDate.textContent = datePart.replace(/-/g, " · ");
                    }
                }
            }

            // Draw a leader line from the active card to its target country.
            if (leaderCtl) {
                leaderCtl.show(element);
            }

            // Push state to the map: fill each country with its price
            // color at this hour and set the focus country (the card's
            // target) to receive the large glowing label treatment.
            if (config.map && typeof config.map.update === "function") {
                const hour = Number(element.dataset.hour);
                const focusCountry = element.dataset.country || null;
                const highlightRaw = element.dataset.highlight || "";
                const highlightCountries = highlightRaw
                    ? highlightRaw.split(",").map((s) => s.trim())
                    : [];
                config.map.update({
                    hour: Number.isFinite(hour) ? hour : null,
                    focusCountry,
                    highlightCountries,
                });
            }

            // Trigger generation-stack reveal when Step 5 enters.
            if (element.dataset.step === "5" && genStackCtl) {
                genStackCtl.reveal();
            }

            // Trigger duck-curve month animation when Step 6 enters.
            if (element.dataset.step === "6" && duckCtl) {
                const months = Object.keys(
                    config.profilesData?.countries?.DE?.monthly || {},
                );
                duckCtl.animateMonths(months, 500);
            }
        })
        .onStepExit(({ element, direction }) => {
            // Always deactivate the exiting step's card. The entering
            // step's onStepEnter also does this, but for fast/jump
            // scrolls the enter might not fire synchronously with
            // the exit, leaving two cards visually "on" at once.
            element.classList.remove("is-active");

            // When scrolling UP past the first step, full cleanup —
            // hide HUD, clock, leader, reset the map to dark base.
            if (direction === "up" && element === steps[0]) {
                document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
                if (hud) hud.classList.remove("is-visible");
                if (mapClock) {
                    mapClock.classList.remove("is-visible");
                    mapClock.classList.remove("is-peak");
                }
                if (leaderCtl) leaderCtl.hide();
                if (config.map && typeof config.map.update === "function") {
                    config.map.update({
                        hour: null,
                        focusCountry: null,
                        highlightCountries: [],
                    });
                }
            }

            // When scrolling DOWN past the last step, release the
            // desaturation so the explorer below gets a vivid map,
            // but keep the clock visible as the reader transitions.
            if (direction === "down" && element === steps[steps.length - 1]) {
                document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
                if (leaderCtl) leaderCtl.hide();
            }
        });

    // Jump-scroll safety net — Scrollama uses IntersectionObserver,
    // which evaluates only the final viewport state after a scroll.
    // If the reader jumps from the explorer (or any deep position)
    // straight to y=0, Step 1 never crosses a threshold, onStepExit
    // never fires, and the HUD / clock stay visible over the hero.
    // This lightweight scroll check detects "we're at the very top
    // AND the HUD is still visible" and forces the full cleanup.
    // Once cleaned up the guard (`hud.classList.contains("is-visible")`)
    // prevents redundant work on subsequent scroll events.
    const checkScrollReset = () => {
        if (window.scrollY > 120) return;
        if (!hud?.classList.contains("is-visible")) return;
        steps.forEach((s) => s.classList.remove("is-active"));
        document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
        hud.classList.remove("is-visible");
        if (mapClock) {
            mapClock.classList.remove("is-visible");
            mapClock.classList.remove("is-peak");
        }
        if (leaderCtl) leaderCtl.hide();
        if (config.map && typeof config.map.update === "function") {
            config.map.update({ hour: null, focusCountry: null, highlightCountries: [] });
        }
    };
    window.addEventListener("scroll", checkScrollReset, { passive: true });

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
        injectCalendarHeatmap,
    };
}


/**
 * Leader line controller — draws a physical line from the active
 * narrative card to the country it is talking about.
 *
 * Motion model
 * ------------
 * The leader has three control points: (start, elbow, dest). Each
 * point is tracked as a critical-damped spring whose target moves
 * when the active step changes or when scroll displaces the card.
 * Every frame we advance all six spring axes by a fixed dt, producing
 * a line that *chases* its target with a natural follow-through,
 * never snapping.
 *
 * The dest circle (the target dot on the country) uses the same
 * springs, so the dot glides across the map from one country to the
 * next on step change and the line + dot stay perfectly in phase.
 *
 * Visibility
 * ----------
 * Springs keep running as long as the loop is active, even when the
 * line is hidden — on the next show() the springs are re-initialised
 * at the current target so the reveal doesn't inherit stale state.
 */
function createLeaderController(svgEl, mapCtl) {
    const NS = "http://www.w3.org/2000/svg";
    const line = document.createElementNS(NS, "path");
    line.setAttribute("class", "leader-line");
    const dotEl = document.createElementNS(NS, "circle");
    dotEl.setAttribute("class", "leader-target");
    dotEl.setAttribute("r", "3");
    const pulseEl = document.createElementNS(NS, "circle");
    pulseEl.setAttribute("class", "leader-target-pulse");
    pulseEl.setAttribute("r", "4");

    svgEl.append(line, pulseEl, dotEl);

    // Critical-damped spring constants. Tuned by feel — stiffness 170
    // + damping 24 gives ~500ms to land with zero overshoot, matches
    // iOS default system spring.
    const SPRING_STIFFNESS = 170;
    const SPRING_DAMPING = 24;
    const SPRING_EPSILON = 0.03;   // stop condition in pixels
    const MAX_DT = 1 / 30;         // clamp step to 30fps worst case

    // Each spring axis has a current position and velocity.
    const springs = {
        startX: { current: 0, target: 0, velocity: 0 },
        startY: { current: 0, target: 0, velocity: 0 },
        elbowX: { current: 0, target: 0, velocity: 0 },
        elbowY: { current: 0, target: 0, velocity: 0 },
        destX:  { current: 0, target: 0, velocity: 0 },
        destY:  { current: 0, target: 0, velocity: 0 },
    };

    let activeStep = null;
    let visible = false;
    let rafHandle = null;
    let lastFrameTime = null;

    /**
     * Compute the desired (start, elbow, dest) for the current step
     * and write them to the spring targets. Does NOT touch `current`
     * so the animation continues from wherever the line actually is.
     */
    function computeTargets() {
        if (!activeStep) return false;
        const iso = activeStep.dataset.country;
        if (!iso) return false;
        const dest = mapCtl.getCountryCentroidPx(iso);
        if (!dest) return false;

        const cardRect = activeStep.getBoundingClientRect();
        const vh = window.innerHeight;
        // Card has scrolled entirely off-viewport — don't update
        // targets so the leader fades out gracefully rather than
        // stretching to chase a card 2000px above or below.
        if (cardRect.bottom < -30 || cardRect.top > vh + 30) {
            return false;
        }

        // Read the headline anchor first so we can derive startY even
        // when the card itself happens to be vertically clipped.
        const headline = activeStep.querySelector(".step__headline");
        const headlineRect = headline
            ? headline.getBoundingClientRect()
            : null;
        const yAnchor = headlineRect
            ? headlineRect.top + headlineRect.height / 2
            : cardRect.top + cardRect.height * 0.4;
        const startX = cardRect.right + 8;
        const startY = yAnchor;

        // Elbow geometry — horizontal stub from the card, scaled by
        // distance, with the vertical drop deferred to the diagonal
        // second segment.
        const stubLen = Math.min(48, Math.max(16, (dest.x - startX) * 0.18));
        const elbowX = startX + stubLen;
        const elbowY = startY;

        springs.startX.target = startX;
        springs.startY.target = startY;
        springs.elbowX.target = elbowX;
        springs.elbowY.target = elbowY;
        springs.destX.target  = dest.x - 6; // 6px gap before the target dot
        springs.destY.target  = dest.y;
        return true;
    }

    /** Snap all current positions to their target (no motion). */
    function snapToTarget() {
        for (const k in springs) {
            springs[k].current = springs[k].target;
            springs[k].velocity = 0;
        }
    }

    /** Step every spring forward by `dt` seconds. */
    function stepSprings(dt) {
        let moving = false;
        for (const k in springs) {
            const s = springs[k];
            const delta = s.target - s.current;
            // Critical-damped spring integrator (semi-implicit Euler).
            const spring = delta * SPRING_STIFFNESS;
            const damper = s.velocity * SPRING_DAMPING;
            const accel = spring - damper;
            s.velocity += accel * dt;
            s.current += s.velocity * dt;
            if (Math.abs(delta) > SPRING_EPSILON || Math.abs(s.velocity) > SPRING_EPSILON) {
                moving = true;
            } else {
                // Settle exactly.
                s.current = s.target;
                s.velocity = 0;
            }
        }
        return moving;
    }

    /** Paint the current spring positions to the DOM. */
    function paint() {
        const sX = springs.startX.current;
        const sY = springs.startY.current;
        const eX = springs.elbowX.current;
        const eY = springs.elbowY.current;
        const dX = springs.destX.current;
        const dY = springs.destY.current;
        line.setAttribute("d", `M${sX},${sY} L${eX},${eY} L${dX},${dY}`);
        dotEl.setAttribute("cx", dX + 6);
        dotEl.setAttribute("cy", dY);
        pulseEl.setAttribute("cx", dX + 6);
        pulseEl.setAttribute("cy", dY);
    }

    let wasOffscreen = false;

    /** The continuous loop. Runs while the leader is visible. */
    function tick(now) {
        rafHandle = null;
        if (!visible) return;

        const dt = lastFrameTime == null
            ? 1 / 60
            : Math.min(MAX_DT, (now - lastFrameTime) / 1000);
        lastFrameTime = now;

        // Recompute targets (the card may have moved since last frame
        // due to page scroll). If the step moved off-screen this
        // returns false and we fade the leader out. When the card
        // scrolls back into view it returns true and we restore it.
        const onscreen = computeTargets();
        if (onscreen !== !wasOffscreen) {
            wasOffscreen = !onscreen;
            line.classList.toggle("is-offscreen", wasOffscreen);
            dotEl.classList.toggle("is-offscreen", wasOffscreen);
            pulseEl.classList.toggle("is-offscreen", wasOffscreen);
        }

        const moving = stepSprings(dt);
        paint();

        // Always schedule the next frame while visible — even once
        // settled — so scroll-driven target updates are picked up
        // immediately. Cost is trivial (no DOM work when settled).
        if (visible) {
            rafHandle = requestAnimationFrame(tick);
        }
    }

    function startLoop() {
        if (rafHandle != null) return;
        lastFrameTime = null;
        rafHandle = requestAnimationFrame(tick);
    }

    function stopLoop() {
        if (rafHandle != null) {
            cancelAnimationFrame(rafHandle);
            rafHandle = null;
        }
    }

    const prefersReducedMotion =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function show(stepEl) {
        const firstShow = activeStep == null;
        activeStep = stepEl;

        visible = true;
        line.classList.add("is-visible");
        dotEl.classList.add("is-visible");
        pulseEl.classList.add("is-pulsing");

        const gotTargets = computeTargets();

        // When reduced motion is preferred, snap directly to the
        // target on every step (no spring animation, no rAF loop).
        if (prefersReducedMotion || (firstShow && gotTargets)) {
            snapToTarget();
        }

        paint();
        if (!prefersReducedMotion) startLoop();
    }

    function hide() {
        activeStep = null;
        visible = false;
        wasOffscreen = false;
        line.classList.remove("is-visible", "is-offscreen");
        dotEl.classList.remove("is-visible", "is-offscreen");
        pulseEl.classList.remove("is-pulsing", "is-offscreen");
        stopLoop();
    }

    /** External redraw trigger. The loop picks up the new target on
     *  its next frame; if the loop is not running we schedule one
     *  frame to re-paint. */
    function redraw() {
        if (!visible) return;
        if (rafHandle == null) startLoop();
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
    // Steps whose chart container has a custom type (heatmap, genstack)
    // are populated by their own dedicated component — skip them here
    // to avoid orphaned sparkline SVGs buried under the real chart.
    const chartType = target.getAttribute("data-step-chart");
    if (chartType && chartType !== "true" && chartType !== "") return;

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


/**
 * Render a small generation-mix donut inside a step card, showing the
 * proportional breakdown of solar/wind/hydro/nuclear/gas at a specific
 * hour. Used on Step 2 to visually reinforce "solar is dominating."
 */
function renderGenDonut(stepEl, showcase, country, hour) {
    const target = stepEl.querySelector("[data-step-chart]");
    if (!target) return;
    const entry = showcase?.countries?.[country]?.[hour];
    if (!entry) return;

    const SOURCES = [
        { key: "solar", label: "Solar", color: "#fbbf24" },
        { key: "wind", label: "Wind", color: "#34d399" },
        { key: "hydro", label: "Hydro", color: "#6366f1" },
        { key: "nuclear", label: "Nuclear", color: "#a855f7" },
        { key: "gas", label: "Gas", color: "#f59e0b" },
    ];

    const slices = SOURCES
        .map((s) => ({ ...s, value: entry[s.key] || 0 }))
        .filter((s) => s.value > 0);

    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (total === 0) return;

    const size = 64;
    const outerR = size / 2 - 2;
    const innerR = outerR * 0.55;

    const wrapper = document.createElement("div");
    wrapper.className = "gen-donut";
    wrapper.style.cssText = "display:inline-block;float:right;margin-left:12px;";

    const svg = d3.select(wrapper)
        .append("svg")
        .attr("viewBox", `0 0 ${size} ${size}`)
        .attr("width", size)
        .attr("height", size);

    const g = svg.append("g")
        .attr("transform", `translate(${size / 2},${size / 2})`);

    const arc = d3.arc().innerRadius(innerR).outerRadius(outerR);
    const pie = d3.pie().value((d) => d.value).sort(null).padAngle(0.03);

    g.selectAll("path")
        .data(pie(slices))
        .join("path")
        .attr("d", arc)
        .attr("fill", (d) => d.data.color)
        .attr("fill-opacity", 0.85);

    // Center label — the dominant source percentage.
    const dominant = slices.reduce((a, b) => (a.value > b.value ? a : b));
    const pct = Math.round((dominant.value / total) * 100);
    g.append("text")
        .attr("class", "gen-donut__label")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .text(`${pct}%`);

    target.insertBefore(wrapper, target.firstChild);
}
