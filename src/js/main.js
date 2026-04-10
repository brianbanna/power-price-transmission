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

    setupHeroParallax();
    setupCursorLight();
    setupSpotTape(showcase);

    console.info("HSquareB initialized");
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
