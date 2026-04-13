// Interactive explorer — Phase 7.
//
// Binds the timeline scrubber to the map controller so the reader can
// drag through the 24 hours of the showcase day and see the map update
// live. Also handles play/pause (keyboard + button), keyboard
// scrubbing via arrow keys, and a right-hand sidebar panel that shows
// generation stack + daily profile + stats for the clicked country.

import { createGenerationStack } from "./charts/generation_stack.js";
import { createDailyProfile } from "./charts/daily_profile.js";

const HOURS = 24;
const FOCUS_COUNTRY = "CH";   // Default sidebar subject — the protagonist
const MS_PER_HOUR_BASE = 760; // Playback cadence at 1x — ~18s for the full day
const VISIBILITY_THRESHOLD = 0.15; // How far into the explorer before it "activates"
const INITIAL_HOUR = 0;       // Start at midnight — reader scrubs forward from calm baseline

// Scroll pause — when the explorer enters the viewport, page scroll
// is blocked for a few seconds to draw the reader's attention to the
// timeline. The lock releases automatically after the pause OR
// immediately if the reader interacts with the timeline (drag, play,
// keyboard). No scroll-jacking — the wheel never drives the timeline.
// Skipped on touch devices.
const SCROLL_PAUSE_DELAY_MS = 600;  // delay before the pause engages
const SCROLL_PAUSE_DURATION_MS = 2000; // how long scroll is blocked
const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches;

const SELECTORS = {
    section: "#explorer",
    timelineWrap: ".explorer__timeline-wrap",
    timeline: "[data-timeline]",
    play: "[data-timeline-play]",
    track: "[data-timeline-track]",
    ticks: "[data-timeline-ticks]",
    hoursLabel: "[data-timeline-hours]",
    fill: "[data-timeline-fill]",
    handle: "[data-timeline-handle]",
    readout: "[data-timeline-hour]",
};

export function initExplorer(config) {
    const section = document.querySelector(SELECTORS.section);
    if (!section) return null;

    const timelineWrap = document.querySelector(SELECTORS.timelineWrap);
    const timeline = section.querySelector(SELECTORS.timeline);
    const playBtn = section.querySelector(SELECTORS.play);
    const track = section.querySelector(SELECTORS.track);
    const ticks = section.querySelector(SELECTORS.ticks);
    const hoursLabel = section.querySelector(SELECTORS.hoursLabel);
    const fill = section.querySelector(SELECTORS.fill);
    const handle = section.querySelector(SELECTORS.handle);
    const readout = section.querySelector(SELECTORS.readout);
    if (!timeline || !track || !fill || !handle || !readout) return null;

    // Render 24 ticks on the track, 1 per hour. Every 6 hours is a
    // major tick. Also render hour labels (00, 06, 12, 18, 24).
    for (let h = 0; h <= HOURS; h++) {
        const tick = document.createElement("span");
        tick.className = "timeline__tick";
        if (h % 6 === 0) tick.classList.add("timeline__tick--major");
        tick.style.left = `${(h / HOURS) * 100}%`;
        ticks.appendChild(tick);
    }
    if (hoursLabel) {
        ["00", "06", "12", "18", "24"].forEach((label) => {
            const el = document.createElement("span");
            el.className = "timeline__hour-label";
            el.textContent = label;
            hoursLabel.appendChild(el);
        });
    }

    const state = {
        hour: INITIAL_HOUR,
        hourFloat: INITIAL_HOUR,
        playing: false,
        rafId: null,
        lastFrameTs: null,
        active: false,
        started: false,
        speedMultiplier: 1,
    };

    // Delay before the pulse hint fires once the reader has crossed
    // into the explorer. Gives the intro headline time to land so
    // the chrome doesn't steal attention from the copy.
    const HINT_DELAY_MS = 1600;
    let hintTimer = null;

    // Purely visual sync of the fill bar, handle, readout, and aria.
    // Does NOT touch the map — that happens only when the integer
    // hour actually changes, to avoid spamming 800ms transitions.
    function renderUI() {
        const frac = state.hourFloat / (HOURS - 1);
        const pct = Math.max(0, Math.min(100, frac * 100));
        fill.style.width = `${pct}%`;
        handle.style.left = `${pct}%`;
        const intHour = Math.min(HOURS - 1, Math.floor(state.hourFloat + 1e-6));
        readout.textContent = `${String(intHour).padStart(2, "0")}:00`;
        track.setAttribute("aria-valuenow", String(intHour));
        track.setAttribute("aria-valuetext", `${String(intHour).padStart(2, "0")}:00 hours`);
    }

    function clearMap() {
        if (config.map?.update) {
            config.map.update({ hour: null, focusCountry: null });
        }
    }

    // Forward-declared sidebar state — initialized by the sidebar
    // block near the end of initExplorer. Read by pushMap so the
    // map focus tracks the sidebar's selected country.
    let sidebarActiveCountry = null;

    function pushMap(hour) {
        if (config.map?.update) {
            const focus = sidebarActiveCountry || FOCUS_COUNTRY;
            config.map.update({ hour, focusCountry: focus });
        }
        // Keep sidebar stats in sync with timeline position.
        if (sidebarActiveCountry) {
            updateSidebarStats(sidebarActiveCountry, hour);
        }
    }

    function markStarted() {
        if (state.started) return;
        state.started = true;
        timeline.classList.remove("is-waiting");
        if (section) section.classList.remove("is-waiting");
    }

    function setHour(h) {
        const clamped = Math.max(0, Math.min(HOURS - 1, Math.round(h)));
        state.hourFloat = clamped;
        markStarted();
        if (clamped !== state.hour) {
            state.hour = clamped;
            pushMap(clamped);
        } else {
            // Same hour — still push in case the map was in empty
            // state (first interaction after explorer entry).
            pushMap(clamped);
        }
        renderUI();
    }

    function play() {
        if (state.playing) return;
        // If at the end, restart from midnight
        if (state.hourFloat >= HOURS - 1) {
            state.hourFloat = 0;
            state.hour = 0;
            pushMap(0);
            renderUI();
        }
        state.playing = true;
        timeline.classList.add("is-playing");
        playBtn?.setAttribute("aria-label", "Pause timeline");
        if (!state.started) {
            markStarted();
            // Kick off at hour 0 for a clean "from the beginning" feel.
            state.hourFloat = 0;
            state.hour = 0;
            pushMap(0);
            renderUI();
        }
        state.lastFrameTs = null;
        const tick = (ts) => {
            if (!state.playing) return;
            if (state.lastFrameTs == null) state.lastFrameTs = ts;
            const dt = Math.min(64, ts - state.lastFrameTs);
            state.lastFrameTs = ts;
            let next = state.hourFloat + (dt * state.speedMultiplier) / MS_PER_HOUR_BASE;
            if (next >= HOURS - 1) next = HOURS - 1;
            state.hourFloat = next;
            const intHour = Math.min(HOURS - 1, Math.floor(next + 1e-6));
            if (intHour !== state.hour) {
                state.hour = intHour;
                pushMap(intHour);
            }
            renderUI();
            // Auto-pause cleanly when we reach the end rather than
            // wrapping back to midnight — the reader gets a definite
            // "day is over" beat instead of an infinite loop.
            if (next >= HOURS - 1) {
                pause();
                return;
            }
            state.rafId = requestAnimationFrame(tick);
        };
        state.rafId = requestAnimationFrame(tick);
    }

    function pause() {
        if (!state.playing) return;
        state.playing = false;
        timeline.classList.remove("is-playing");
        playBtn?.setAttribute("aria-label", "Play timeline");
        if (state.rafId != null) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
    }

    function togglePlay() {
        if (state.playing) pause(); else play();
    }

    // ---- First-encounter hint ----
    // The timeline handle pulses gently the first time the reader
    // sees the explorer, to signal that it's interactive. The pulse
    // is a CSS-only animation triggered by the is-hinting class; it
    // plays three times and then stops via a CSS `animation-iteration-count`
    // of 3. The is-touched class kills it permanently the first time
    // the reader actually interacts with the timeline.
    const markTouched = () => {
        timeline.classList.add("is-touched");
        timeline.classList.remove("is-hinting");
        // Also cancel any pending hint-delay timer so a late touch
        // during the 1.6s delay doesn't produce a stale pulse.
        if (hintTimer) {
            clearTimeout(hintTimer);
            hintTimer = null;
        }
    };

    playBtn?.addEventListener("click", () => {
        markTouched();
        togglePlay();
    });

    // ---- Drag scrubbing ----
    let dragging = false;
    const pointerToHour = (event) => {
        const rect = track.getBoundingClientRect();
        const raw = (event.clientX - rect.left) / rect.width;
        const clamped = Math.max(0, Math.min(1, raw));
        return Math.round(clamped * (HOURS - 1));
    };

    track.addEventListener("pointerdown", (e) => {
        dragging = true;
        track.setPointerCapture?.(e.pointerId);
        markTouched();
        pause();
        setHour(pointerToHour(e));
    });
    track.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        setHour(pointerToHour(e));
    });
    const endDrag = () => { dragging = false; };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    track.addEventListener("pointerleave", endDrag);

    // ---- Keyboard ----
    track.addEventListener("keydown", (e) => {
        // Any keyboard nudge counts as "touched" and silences the hint.
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", " ", "Enter"].includes(e.key)) {
            markTouched();
        }
        switch (e.key) {
            case "ArrowLeft":
            case "ArrowDown":
                e.preventDefault();
                pause();
                setHour(state.hour - 1);
                break;
            case "ArrowRight":
            case "ArrowUp":
                e.preventDefault();
                pause();
                setHour(state.hour + 1);
                break;
            case "Home":
                e.preventDefault();
                pause();
                setHour(0);
                break;
            case "End":
                e.preventDefault();
                pause();
                setHour(HOURS - 1);
                break;
            case " ":
            case "Enter":
                e.preventDefault();
                togglePlay();
                break;
        }
    });

    // ---- Color mode toggle (price / renewable %) ----
    const modeBtns = section.querySelectorAll("[data-mode]");
    modeBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.mode || "price";
            modeBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
            if (config.map?.update) {
                config.map.update({ colorMode: mode });
                // Re-push current hour so the fill repaints.
                pushMap(state.hour);
            }
        });
    });

    // ---- Speed control (1x / 2x / 4x) ----
    const speedBtns = section.querySelectorAll("[data-speed]");
    speedBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const multiplier = Number(btn.dataset.speed) || 1;
            state.speedMultiplier = multiplier;
            speedBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
        });
    });

    // ---- Global spacebar play/pause when the explorer is in view ----
    document.addEventListener("keydown", (e) => {
        if (e.key !== " " || !state.active) return;
        // Ignore if focus is in an input/textarea
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        markTouched();
        togglePlay();
    });

    // ---- Activation via IntersectionObserver ----
    // We track whether the explorer is visible enough that spacebar
    // should be claimed. Also used to auto-pause when the reader
    // scrolls back up into the story.
    const observer = new IntersectionObserver(
        ([entry]) => {
            const wasActive = state.active;
            state.active = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;

            if (state.active && !wasActive) {
                // First time entering — show the map at hour 0
                // (midnight, calm baseline) so the reader sees content
                // immediately rather than a confusing blank state.
                if (!state.started) {
                    pushMap(0);
                    timeline.classList.add("is-waiting");
                    section.classList.add("is-waiting");
                }
            } else if (!state.active && wasActive) {
                // Left the explorer view — auto-pause playback.
                pause();
            }
        },
        { threshold: [0, VISIBILITY_THRESHOLD, 0.5, 1] },
    );
    observer.observe(section);

    // ---- Fixed chrome hiding + first-encounter hint trigger ----
    //
    // The timeline dock is native CSS sticky now (see style.css), so
    // no JS opacity writes here. We only:
    //   1. Toggle the map clock + HUD off when the reader is inside
    //      the explorer (the timeline readout owns the hour display).
    //   2. Add the `is-hinting` class the first time the timeline
    //      becomes meaningfully visible, so the handle pulses three
    //      times to signal interactivity. Cleared permanently the
    //      first time the reader actually touches the timeline.
    const mapClock = document.querySelector("[data-map-clock]");
    const hud = document.querySelector(".hud");
    let hintArmed = false;

    const updateChrome = () => {
        const sectionRect = section.getBoundingClientRect();
        const vh = window.innerHeight;
        // "Meaningfully inside" = the explorer's top has risen to the
        // upper third of the viewport. At that point the intro is
        // fully visible and the sticky timeline is docked.
        const inExplorer = sectionRect.top < vh * 0.55 && sectionRect.bottom > 0;
        if (mapClock) {
            mapClock.classList.toggle("is-hidden-by-explorer", inExplorer);
        }
        if (hud) {
            hud.classList.toggle("is-hidden-by-explorer", inExplorer);
        }

        // Arm the hint once when the reader crosses into the explorer.
        // Delayed ~1.6s so the headline lands before the chrome pings.
        // Skips silently if the timeline has already been touched.
        if (inExplorer && !hintArmed && !timeline.classList.contains("is-touched")) {
            hintArmed = true;
            hintTimer = setTimeout(() => {
                // Guard: reader may have touched the timeline during
                // the delay (e.g., pressed space). Check again.
                if (!timeline.classList.contains("is-touched")) {
                    timeline.classList.add("is-hinting");
                }
            }, HINT_DELAY_MS);
        }
    };

    let chromeTicking = false;
    const scheduleChrome = () => {
        if (chromeTicking) return;
        chromeTicking = true;
        requestAnimationFrame(() => {
            updateChrome();
            chromeTicking = false;
        });
    };
    updateChrome();
    window.addEventListener("scroll", scheduleChrome, { passive: true });
    window.addEventListener("resize", scheduleChrome);

    // ---- Timeline fade-in synced to the headline ----
    //
    // Watch the explorer headline. When it crosses into the viewport
    // (~30% visible), add `.is-visible` to the timeline wrap so the
    // CSS opacity + transform transition fades the timeline up at the
    // same beat the title appears. The reader perceives the title and
    // the scrubber as appearing together as one composition.
    //
    // Once visible, stays visible for the lifetime of the page so
    // scrolling back doesn't make the timeline blink.
    const headlineEl = section.querySelector(".explorer__headline");
    if (headlineEl && timelineWrap) {
        const fadeObserver = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    timelineWrap.classList.add("is-visible");
                    fadeObserver.disconnect();
                }
            },
            { threshold: 0.35 },
        );
        fadeObserver.observe(headlineEl);
    }

    // ---- Scroll pause ----
    //
    // A brief scroll freeze when the explorer enters the viewport.
    // The page stops scrolling for ~3.5 seconds, drawing the reader's
    // attention to the timeline and the "scroll to move through the
    // day" prompt. The lock releases automatically after the pause,
    // OR immediately if the reader interacts with the timeline
    // (click play, drag, or keyboard). No scroll-jacking — the wheel
    // never drives the timeline.
    //
    // Fires only once per page load so scrolling back through the
    // explorer later is free.
    const scrollPause = { active: false, fired: false };

    if (!IS_TOUCH) {
        const onWheel = (e) => {
            if (!scrollPause.active) return;
            e.preventDefault();
        };
        document.addEventListener("wheel", onWheel, { passive: false });

        // Release the pause — called by the auto-timer and by any
        // timeline interaction (play, drag, keyboard).
        const releasePause = () => {
            scrollPause.active = false;
            section.classList.remove("is-scroll-locked");
            section.classList.add("is-scroll-released");
            document.removeEventListener("wheel", onWheel);
        };

        // Hook into markTouched so any timeline interaction releases.
        const origMarkTouched = markTouched;
        markTouched = () => {
            origMarkTouched();
            if (scrollPause.active) releasePause();
        };

        // One-shot observer: pause scroll when the explorer first
        // enters the viewport, then disconnect.
        const pauseObserver = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting || scrollPause.fired) return;
                scrollPause.fired = true;
                pauseObserver.disconnect();

                // Brief delay so the reader finishes arriving.
                setTimeout(() => {
                    // Guard: reader may have already interacted or
                    // scrolled away during the delay.
                    const rect = section.getBoundingClientRect();
                    if (rect.top > window.innerHeight * 0.7 || rect.bottom < 0) return;

                    scrollPause.active = true;
                    section.classList.add("is-scroll-locked");

                    // Auto-release after the pause duration.
                    setTimeout(() => {
                        if (scrollPause.active) releasePause();
                    }, SCROLL_PAUSE_DURATION_MS);
                }, SCROLL_PAUSE_DELAY_MS);
            },
            { threshold: 0.3 },
        );
        pauseObserver.observe(section);
    }

    // ---- Sidebar panel ----
    //
    // Click a country on the map to open a right-hand sidebar showing
    // its generation stack and daily price profile for the current
    // hour on the showcase day. The sidebar updates when the timeline
    // moves and when the reader clicks a different country.
    const sidebar = document.querySelector("[data-sidebar]");
    const sidebarClose = document.querySelector("[data-sidebar-close]");
    const sidebarCountry = document.querySelector("[data-sidebar-country]");
    const sidebarPrice = document.querySelector("[data-sidebar-price]");
    const sidebarRenewable = document.querySelector("[data-sidebar-renewable]");
    const sidebarSpread = document.querySelector("[data-sidebar-spread]");
    const sidebarGenContainer = document.querySelector("[data-sidebar-genstack]");
    const sidebarProfileContainer = document.querySelector("[data-sidebar-profile]");

    const COUNTRY_NAMES = {
        CH: "Switzerland", DE: "Germany", FR: "France",
        IT: "Italy", AT: "Austria",
    };

    let sidebarGenCtl = null;
    let sidebarProfileCtl = null;
    // sidebarActiveCountry is declared above pushMap (line ~120).

    function updateSidebarStats(countryCode, hour) {
        if (!showcase?.countries) return;
        const entry = showcase.countries[countryCode]?.[hour];
        if (!entry) return;
        const sign = entry.price < 0 ? "\u2212" : "";
        const abs = Math.abs(entry.price).toFixed(1);
        if (sidebarPrice) sidebarPrice.textContent = `${sign}\u20AC${abs}`;
        if (sidebarRenewable) {
            sidebarRenewable.textContent = `${(entry.renewable_share * 100).toFixed(0)}%`;
        }
        if (sidebarSpread) {
            const itPrice = showcase.countries.IT?.[hour]?.price;
            if (itPrice != null) {
                const spread = Math.abs(entry.price - itPrice).toFixed(0);
                sidebarSpread.textContent = `\u20AC${spread}`;
            }
        }
    }

    function openSidebar(countryCode) {
        if (!sidebar || !showcase?.countries?.[countryCode]) return;
        sidebarActiveCountry = countryCode;
        if (sidebarCountry) sidebarCountry.textContent = COUNTRY_NAMES[countryCode] || countryCode;

        // Update the map focus to this country.
        pushMap(state.hour);

        updateSidebarStats(countryCode, state.hour);

        // Rebuild charts for the new country.
        if (sidebarGenCtl) { sidebarGenCtl.destroy(); sidebarGenCtl = null; }
        if (sidebarProfileCtl) { sidebarProfileCtl.destroy(); sidebarProfileCtl = null; }

        if (sidebarGenContainer) {
            while (sidebarGenContainer.firstChild) sidebarGenContainer.removeChild(sidebarGenContainer.firstChild);
            const series = showcase.countries[countryCode];
            if (series) {
                sidebarGenCtl = createGenerationStack(sidebarGenContainer, {
                    series,
                    country: countryCode,
                    label: `${COUNTRY_NAMES[countryCode] || countryCode} — 12 May 2024`,
                });
                sidebarGenCtl.reveal();
            }
        }

        if (sidebarProfileContainer && config.profilesData?.countries?.[countryCode]) {
            while (sidebarProfileContainer.firstChild) sidebarProfileContainer.removeChild(sidebarProfileContainer.firstChild);
            sidebarProfileCtl = createDailyProfile(sidebarProfileContainer, {
                profiles: config.profilesData.countries[countryCode],
                country: countryCode,
                label: `Daily price profile`,
            });
        }

        sidebar.classList.add("is-open");
    }

    function closeSidebar() {
        if (!sidebar) return;
        sidebar.classList.remove("is-open");
        sidebarActiveCountry = null;
        // Reset focus to the default protagonist.
        pushMap(state.hour);
    }

    // Wire country clicks on the map.
    if (sidebar) {
        document.querySelectorAll(".country").forEach((el) => {
            el.style.cursor = "pointer";
            el.addEventListener("click", () => {
                const iso = el.getAttribute("data-iso");
                if (!iso) return;
                if (sidebarActiveCountry === iso) {
                    closeSidebar();
                } else {
                    openSidebar(iso);
                }
            });
        });
        if (sidebarClose) {
            sidebarClose.addEventListener("click", closeSidebar);
        }
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && sidebar?.classList.contains("is-open")) {
                closeSidebar();
            }
        });
        document.addEventListener("click", (e) => {
            if (!sidebar?.classList.contains("is-open")) return;
            if (sidebar.contains(e.target) || e.target.closest(".country")) return;
            closeSidebar();
        });
    }

    // Paint the initial UI state (handle at INITIAL_HOUR, readout set)
    // without touching the map — the map only updates once the reader
    // actually presses play or starts scrubbing.
    renderUI();

    return {
        play,
        pause,
        togglePlay,
        setHour,
        openSidebar,
        closeSidebar,
    };
}
