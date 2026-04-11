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
const INITIAL_HOUR = 0;       // Start at midnight — reader scrubs forward from calm baseline

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

    // ---- Fixed chrome hiding ----
    //
    // The timeline dock is native CSS sticky now (see style.css), so
    // no JS opacity writes here. We only toggle the map clock + HUD
    // on/off based on whether the reader is inside the explorer
    // section — when they are, those fixed chrome items step aside
    // because the timeline readout owns the current-hour display.
    const mapClock = document.querySelector("[data-map-clock]");
    const hud = document.querySelector(".hud");

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
