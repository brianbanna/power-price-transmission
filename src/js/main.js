import { createMap } from "./map.js";
import { initNarrative } from "./narrative.js";
import { initExplorer } from "./explorer.js";
import { loadJSON } from "./utils/data.js";

// Entry point. Wires the map and the scrollytelling narrative together
// once the DOM is ready. Individual modules are responsible for their
// own rendering; this file only coordinates their lifecycle.

async function init() {
    const [topology, showcase] = await Promise.all([
        loadJSON("map.topojson"),
        loadJSON("showcase_day.json"),
    ]);

    const map = createMap("#map-container", { topology, showcase });
    initNarrative("#narrative", { map, showcase });
    initExplorer({ map, showcase });

    setupHeroParallax();
    setupCursorLight();
    setupSpotTape(showcase);
    setupCircadianTint();
    setupMapTilt();
    setupIrisWipe();
    setupFooterHide();

    console.info("HSquareB initialized");
}

/**
 * Hide the map clock (and HUD) once the footer scrolls into view,
 * so those fixed-position readouts don't fight the footer's content
 * at the very bottom of the page.
 */
function setupFooterHide() {
    const footer = document.querySelector(".site-footer");
    if (!footer) return;
    const clock = document.querySelector("[data-map-clock]");
    const hud = document.querySelector(".hud");
    const observer = new IntersectionObserver(
        ([entry]) => {
            const fade = entry.isIntersecting;
            if (clock) clock.classList.toggle("is-hidden-by-footer", fade);
            if (hud) hud.classList.toggle("is-hidden-by-footer", fade);
        },
        { threshold: 0 },
    );
    observer.observe(footer);
}

/**
 * Iris wipe — the map's vignette briefly contracts then expands as
 * the reader leaves the hero for the first time, with the grain
 * overlay flashing up simultaneously. An old news-broadcast "on-air"
 * cue signalling "the story begins now."
 *
 * Fires exactly once per page load, at ~25% of viewport scrolled.
 */
const IRIS_THRESHOLD = 0.25;
const IRIS_DURATION_MS = 700;

function setupIrisWipe() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let fired = false;
    const onScroll = () => {
        if (fired) return;
        const p = window.scrollY / window.innerHeight;
        if (p < IRIS_THRESHOLD) return;
        fired = true;
        document.body.classList.add("is-iris-firing");
        setTimeout(() => {
            document.body.classList.remove("is-iris-firing");
        }, IRIS_DURATION_MS);
        window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
}

/**
 * Map vertical scroll position to a subtle circadian color wash on the
 * map. The tint never fights the palette — it only interpolates between
 * very low-opacity versions of colors already in the design system:
 *
 *   top      → cold dawn (accent-dim)
 *   middle   → neutral calm
 *   lower    → warm solar (gen-solar, low opacity)
 *   near end → ice-cold (accent-glow, the shock)
 *
 * Written to `--atmos-tint` on :root and picked up by a CSS layer on
 * the map. Uses a single rAF loop shared with other scroll hooks.
 */
function setupCircadianTint() {
    const root = document.documentElement;
    const stops = [
        { at: 0.00, color: "rgba(14, 116, 144, 0.12)" },   // accent-dim
        { at: 0.30, color: "rgba(71, 85, 105, 0.08)" },    // slate neutral
        { at: 0.55, color: "rgba(251, 191, 36, 0.07)" },   // muted solar gold
        { at: 0.80, color: "rgba(34, 211, 238, 0.10)" },   // cold cyan
        { at: 1.00, color: "rgba(224, 247, 255, 0.06)" },  // ice-white shock
    ];

    const parseRGBA = (s) => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return [0, 0, 0, 0];
        return m[1].split(",").map(Number);
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    const sample = (p) => {
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            if (p >= a.at && p <= b.at) {
                const t = (p - a.at) / (b.at - a.at);
                const ca = parseRGBA(a.color);
                const cb = parseRGBA(b.color);
                const r = Math.round(lerp(ca[0], cb[0], t));
                const g = Math.round(lerp(ca[1], cb[1], t));
                const bl = Math.round(lerp(ca[2], cb[2], t));
                const al = (lerp(ca[3], cb[3], t)).toFixed(3);
                return `rgba(${r}, ${g}, ${bl}, ${al})`;
            }
        }
        return stops[stops.length - 1].color;
    };

    let ticking = false;
    const update = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
            root.style.setProperty("--atmos-tint", sample(p));
            ticking = false;
        });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
}

/**
 * Map tilt — a scroll-driven 3D perspective rotation on the sticky
 * map SVG. Nothing happens in the hero (the map is hidden behind it);
 * as the reader enters the scene and approaches the peak-moment card,
 * the map rotates ~11° on the X axis, as if tipping up to face the
 * reader. The tilt eases back down through the explorer.
 *
 * The raw signal comes from the scene's bounding rect so the curve
 * survives layout changes without recalculation.
 *
 * Implementation note: this is a pure presentation layer — the tilt
 * value is written to `--map-tilt` on `:root`, and the CSS transform
 * on `.scene__map svg` multiplies it by the max angle. No DOM writes
 * happen per-frame except the single custom-property update.
 */
const MAP_TILT_MAX = 1;
const MAP_TILT_EXPLORER = 0.42;

function setupMapTilt() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scene = document.querySelector(".scene");
    const peakCard = document.querySelector('.step[data-step="3"]');
    if (!scene) return;
    const root = document.documentElement;

    let ticking = false;
    const update = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const vh = window.innerHeight;
            const sceneRect = scene.getBoundingClientRect();

            // Scene hasn't entered the viewport — map is effectively
            // hidden behind the hero. Keep the tilt at 0 so the first
            // reveal lands on a flat plane.
            if (sceneRect.top > vh * 0.65) {
                root.style.setProperty("--map-tilt", "0");
                ticking = false;
                return;
            }

            // Peak target — the tilt crescendoes when the peak-moment
            // card (Step 3) is centered in the viewport. That's the
            // beat where CH drops below DE in the narrative copy.
            let tilt = 0.2; // baseline entry tilt once scene is visible
            if (peakCard) {
                const peakRect = peakCard.getBoundingClientRect();
                const peakCenter = peakRect.top + peakRect.height / 2;
                const distFromMid = Math.abs(peakCenter - vh * 0.5);
                // Gaussian-ish falloff: full tilt when card is centered,
                // decaying to ~0.3 beyond ±60% of viewport height.
                const proximity = Math.max(0, 1 - distFromMid / (vh * 0.6));
                tilt = Math.max(tilt, proximity * MAP_TILT_MAX);
            }

            // Past the narrative, the explorer wants a gentler persistent
            // tilt so the scrubbing reader feels like they're looking
            // "into" the map rather than straight at it.
            if (sceneRect.bottom < vh * 0.9 && sceneRect.bottom > 0) {
                tilt = Math.max(tilt, MAP_TILT_EXPLORER);
            }

            root.style.setProperty("--map-tilt", tilt.toFixed(3));
            ticking = false;
        });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
}

/**
 * Spot-price tape — the trading-floor ticker under the hero byline.
 *
 * Cycles through 4 key hours of the showcase day every 5.5 seconds,
 * flashing each quote briefly as it updates and re-styling negative
 * prices with the true minus sign + ice-white glow color.
 *
 * Hours chosen tell the whole story in preview: midnight calm,
 * mid-morning dip, peak negative shock, evening recovery.
 */
const TAPE_HOURS = [0, 10, 13, 19];
const TAPE_INTERVAL_MS = 5500;

function setupSpotTape(showcase) {
    const tape = document.querySelector("[data-hero-tape]");
    if (!tape || !showcase?.countries) return;

    const timestampEl = tape.querySelector("[data-tape-timestamp]");
    const priceEls = {
        CH: tape.querySelector('[data-tape-price="CH"]'),
        DE: tape.querySelector('[data-tape-price="DE"]'),
        FR: tape.querySelector('[data-tape-price="FR"]'),
        IT: tape.querySelector('[data-tape-price="IT"]'),
        AT: tape.querySelector('[data-tape-price="AT"]'),
    };

    const renderHour = (hour) => {
        const padded = String(hour).padStart(2, "0");
        if (timestampEl) {
            timestampEl.textContent = `${showcase.date} · ${padded}:00 CET`;
        }
        for (const [code, el] of Object.entries(priceEls)) {
            if (!el) continue;
            const entry = showcase.countries[code]?.[hour];
            if (!entry) continue;
            const price = entry.price;
            el.textContent = formatPrice(price);
            el.classList.toggle("is-negative", price < 0);
            // Brief "flash" on update so the reader sees motion
            el.classList.add("is-flash");
            setTimeout(() => el.classList.remove("is-flash"), 480);
        }
    };

    let idx = 0;
    renderHour(TAPE_HOURS[idx]);
    setInterval(() => {
        idx = (idx + 1) % TAPE_HOURS.length;
        renderHour(TAPE_HOURS[idx]);
    }, TAPE_INTERVAL_MS);
}

function formatPrice(value) {
    const abs = Math.abs(value).toFixed(0);
    const sign = value < 0 ? "\u2212" : ""; // U+2212
    return `${sign}${abs}`;
}

/**
 * Parallax the hero lines as the reader scrolls out of the opening
 * screen. Each title line drifts up at a slightly different rate,
 * the eyebrow/masthead fade first, the lede last. The whole hero
 * becomes transparent by the time it has scrolled half out of view
 * so the map underneath reveals cleanly.
 */
const HERO_REVEAL_DURATION_MS = 3100;

function setupHeroParallax() {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const titleLines = Array.from(hero.querySelectorAll(".hero__title-line"));
    const eyebrow = hero.querySelector(".hero__eyebrow");
    const masthead = hero.querySelector(".hero__masthead");
    const lede = hero.querySelector(".hero__lede");
    const signature = hero.querySelector(".hero__signature");

    // The CSS reveal animation owns these properties during the
    // opening sequence. Don't touch them until the reveal is done,
    // otherwise inline styles fight keyframes mid-animation.
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; onScroll(); }, HERO_REVEAL_DURATION_MS);

    let ticking = false;
    const onScroll = () => {
        if (!armed) return;
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const viewport = window.innerHeight;
            const progress = Math.min(1, Math.max(0, window.scrollY / (viewport * 0.85)));

            // Each title line drifts up at a different rate for subtle parallax
            titleLines.forEach((line, i) => {
                const factor = 40 + i * 28;
                const fade = Math.max(0, 1 - progress * 1.4);
                line.style.transform = `translate3d(0, ${-progress * factor}px, 0)`;
                line.style.opacity = `${fade}`;
            });
            if (eyebrow) {
                eyebrow.style.transform = `translate3d(0, ${-progress * 80}px, 0)`;
                eyebrow.style.opacity = `${Math.max(0, 1 - progress * 1.8)}`;
            }
            if (masthead) {
                masthead.style.transform = `translate3d(0, ${-progress * 100}px, 0)`;
                masthead.style.opacity = `${Math.max(0, 1 - progress * 2)}`;
            }
            if (lede) {
                lede.style.transform = `translate3d(0, ${-progress * 22}px, 0)`;
                lede.style.opacity = `${Math.max(0, 1 - progress * 1.2)}`;
            }
            if (signature) {
                signature.style.transform = `translate3d(0, ${-progress * 14}px, 0)`;
                signature.style.opacity = `${Math.max(0, 1 - progress * 1.1)}`;
            }
            ticking = false;
        });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { clearTimeout(armTimer); };
}

/**
 * Cursor-following soft glow on the hero background. A low-intensity
 * radial gradient whose center tracks the mouse, creating the feeling
 * that the reader's attention leaves a trace. Only active inside the
 * hero itself, disabled on touch/reduced-motion.
 */
function setupCursorLight() {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    hero.classList.add("has-cursor-light");
    const update = (e) => {
        const rect = hero.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        hero.style.setProperty("--cursor-x", `${x}%`);
        hero.style.setProperty("--cursor-y", `${y}%`);
    };
    hero.addEventListener("pointermove", update);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
