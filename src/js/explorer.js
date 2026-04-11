// Interactive explorer — Phase 7.
//
// Binds the timeline scrubber to the map controller so the reader can
// drag through the 24 hours of the showcase day and see the map update
// live. Also handles play/pause (keyboard + button) and keyboard
// scrubbing via arrow keys on the focused track.

const HOURS = 24;
const FOCUS_COUNTRY = "CH";   // Default sidebar subject — the protagonist
const PLAYBACK_INTERVAL_MS = 600;  // 1 hour per 600ms ≈ 14 seconds full day
const VISIBILITY_THRESHOLD = 0.15; // How far into the explorer before it "activates"
const INITIAL_HOUR = 13;      // Pick up where Step 3 left off — the peak moment

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
        playing: false,
        playTimer: null,
        active: false,  // has the reader scrolled the explorer into view?
    };

    function render() {
        const pct = (state.hour / (HOURS - 1)) * 100;
        fill.style.width = `${pct}%`;
        handle.style.left = `${pct}%`;
        readout.textContent = `${String(state.hour).padStart(2, "0")}:00`;
        track.setAttribute("aria-valuenow", String(state.hour));
        track.setAttribute("aria-valuetext", `${String(state.hour).padStart(2, "0")}:00 hours`);
        if (config.map?.update) {
            config.map.update({ hour: state.hour, focusCountry: FOCUS_COUNTRY });
        }
    }

    function setHour(h) {
        const clamped = Math.max(0, Math.min(HOURS - 1, Math.round(h)));
        if (clamped === state.hour) return;
        state.hour = clamped;
        render();
    }

    function play() {
        if (state.playing) return;
        state.playing = true;
        timeline.classList.add("is-playing");
        playBtn?.setAttribute("aria-label", "Pause timeline");
        state.playTimer = setInterval(() => {
            const next = (state.hour + 1) % HOURS;
            state.hour = next;
            render();
        }, PLAYBACK_INTERVAL_MS);
    }

    function pause() {
        if (!state.playing) return;
        state.playing = false;
        timeline.classList.remove("is-playing");
        playBtn?.setAttribute("aria-label", "Play timeline");
        if (state.playTimer) {
            clearInterval(state.playTimer);
            state.playTimer = null;
        }
    }

    function togglePlay() {
        if (state.playing) pause(); else play();
    }

    playBtn?.addEventListener("click", togglePlay);

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

    // ---- Global spacebar play/pause when the explorer is in view ----
    document.addEventListener("keydown", (e) => {
        if (e.key !== " " || !state.active) return;
        // Ignore if focus is in an input/textarea
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
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
                // First time entering — render the initial state so the
                // map picks up hour 0 for the showcase day.
                render();
            } else if (!state.active && wasActive) {
                // Left the explorer view — auto-pause playback.
                pause();
            }
        },
        { threshold: [0, VISIBILITY_THRESHOLD, 0.5, 1] },
    );
    observer.observe(section);

    // ---- Timeline dock + fixed chrome hiding ----
    //
    // Tracks the intro HEADLINE (not the whole section) as the fade
    // anchor. The timeline starts fading in the moment the headline
    // reaches 25% up from the bottom of the viewport, and is fully
    // visible when the headline is at the middle of the viewport.
    //
    //   headline.top >= 0.75 * vh  →  opacity 0  (headline still below)
    //   headline.top <= 0.50 * vh  →  opacity 1  (headline at mid-screen)
    //
    // Chrome (HUD + big clock) hides with the same headline-anchored
    // rule at its own threshold.
    const mapClock = document.querySelector("[data-map-clock]");
    const hud = document.querySelector(".hud");
    const introHeadline = section.querySelector(".explorer__headline")
        || section.querySelector(".explorer__intro");

    const FADE_START = 0.75;  // headline.top / vh — fade begins (timeline: 0)
    const FADE_END   = 0.50;  // headline.top / vh — fade completes (timeline: 1)
    const HIDE_CHROME_AT = 0.65; // headline.top / vh — HUD + clock hide below this

    const smoothstep = (a, b, t) => {
        const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
        return x * x * (3 - 2 * x);  // ease in-out
    };

    const updateDock = () => {
        const sectionRect = section.getBoundingClientRect();
        const vh = window.innerHeight;

        // Anchor: top of the headline (or the intro box as fallback).
        // Fall back to the section itself if neither is reachable.
        const anchorRect = (introHeadline || section).getBoundingClientRect();
        const anchorTop = anchorRect.top / vh;

        // Progress ramps from 0 → 1 as the anchor rises past the two
        // thresholds. FADE_START > FADE_END because top decreases as
        // the page scrolls down.
        const progress = smoothstep(FADE_START, FADE_END, anchorTop);

        // Extinguish opacity entirely once the explorer has left the
        // viewport completely (scrolled past, or not yet entered).
        const gone = sectionRect.bottom <= 0 || sectionRect.top > vh;
        const opacity = gone ? 0 : progress;

        if (timelineWrap) {
            timelineWrap.style.opacity = opacity.toFixed(3);
            const lift = (1 - opacity) * 24;
            timelineWrap.style.transform = `translateY(${lift}px)`;
            timelineWrap.style.pointerEvents = opacity > 0.45 ? "auto" : "none";
        }

        // Chrome hides: binary, fires once the headline has risen
        // meaningfully into the viewport.
        const chromeHidden = !gone && anchorTop < HIDE_CHROME_AT;
        if (mapClock) {
            mapClock.classList.toggle("is-hidden-by-explorer", chromeHidden);
        }
        if (hud) {
            hud.classList.toggle("is-hidden-by-explorer", chromeHidden);
        }
    };
    // rAF-throttle so opacity writes happen at most once per frame.
    let dockTicking = false;
    const scheduleDock = () => {
        if (dockTicking) return;
        dockTicking = true;
        requestAnimationFrame(() => {
            updateDock();
            dockTicking = false;
        });
    };

    updateDock();
    window.addEventListener("scroll", scheduleDock, { passive: true });
    window.addEventListener("resize", scheduleDock);

    // Paint the initial UI state (handle at INITIAL_HOUR, readout set)
    // without touching the map — the map only updates once the reader
    // actually scrolls the explorer into view.
    const pct = (state.hour / (HOURS - 1)) * 100;
    fill.style.width = `${pct}%`;
    handle.style.left = `${pct}%`;
    readout.textContent = `${String(state.hour).padStart(2, "0")}:00`;
    track.setAttribute("aria-valuenow", String(state.hour));

    return {
        play,
        pause,
        togglePlay,
        setHour,
    };
}
