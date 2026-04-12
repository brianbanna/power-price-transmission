import { createMap } from "./map.js";
import { initNarrative } from "./narrative.js";
import { initExplorer } from "./explorer.js";
import { loadJSON } from "./utils/data.js";

// Entry point. Wires the map and the scrollytelling narrative together
// once the DOM is ready. Individual modules are responsible for their
// own rendering; this file only coordinates their lifecycle.

async function init() {
    const [topology, showcase, calendarData] = await Promise.all([
        loadJSON("map.topojson"),
        loadJSON("showcase_day.json"),
        loadJSON("calendar_heatmap.json"),
    ]);

    const map = createMap("#map-container", { topology, showcase });
    initNarrative("#narrative", { map, showcase, calendarData });
    initExplorer({ map, showcase });

    setupHeroTitleReveal();
    setupHeroColdOpen();
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

    // scrollHeight triggers layout — cache it and invalidate only
    // on resize. Without this, every scroll tick forces a reflow.
    let maxScroll = Math.max(0,
        document.documentElement.scrollHeight - window.innerHeight);
    let lastTintBucket = -1;
    const TINT_BUCKETS = 50;

    let ticking = false;
    const update = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const p = maxScroll > 0
                ? Math.min(1, Math.max(0, window.scrollY / maxScroll))
                : 0;
            // Quantize to 50 buckets so successive near-identical
            // scroll positions don't burn CPU resampling the gradient.
            const bucket = Math.round(p * TINT_BUCKETS);
            if (bucket !== lastTintBucket) {
                lastTintBucket = bucket;
                root.style.setProperty("--atmos-tint", sample(bucket / TINT_BUCKETS));
            }
            ticking = false;
        });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", () => {
        maxScroll = Math.max(0,
            document.documentElement.scrollHeight - window.innerHeight);
        lastTintBucket = -1;
        update();
    });
}

/**
 * Hero title reveal — split each title line into per-character spans
 * so the reveal feels like the letters are being struck one at a time
 * in Fraunces, rather than whole lines sliding up in unison.
 *
 * The walker preserves any wrapping element (`<em>`, the `.hero__amp`,
 * the terminal mark) so their styling continues to apply. Whitespace
 * is left as plain text and doesn't get its own span — spaces don't
 * need to animate, and keeping them as text nodes means the browser
 * handles line-breaking naturally.
 *
 * Per-line base delays stagger the start; per-char intra-line delays
 * stagger each letter by CHAR_STAGGER_MS so longer lines take longer
 * to finish.
 */
const TITLE_LINE_BASE_DELAYS_MS = [400, 780, 1160];
const TITLE_CHAR_STAGGER_MS = 36;

function setupHeroTitleReveal() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lines = Array.from(document.querySelectorAll(".hero__title-line"));
    if (lines.length === 0) return;

    lines.forEach((line, lineIdx) => {
        const baseDelay = TITLE_LINE_BASE_DELAYS_MS[lineIdx] ?? 400;
        let charIdx = 0;

        const walk = (node) => {
            // Text node — wrap each non-space char in a char span; leave
            // whitespace as plain text so the browser can wrap lines.
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!text) return [];
                const frag = document.createDocumentFragment();
                for (const ch of text) {
                    if (ch === " " || ch === "\u00A0") {
                        frag.appendChild(document.createTextNode(ch));
                        continue;
                    }
                    const span = document.createElement("span");
                    span.className = "hero__title-char";
                    span.textContent = ch;
                    span.style.setProperty(
                        "--char-delay",
                        `${baseDelay + charIdx * TITLE_CHAR_STAGGER_MS}ms`,
                    );
                    charIdx += 1;
                    frag.appendChild(span);
                }
                node.parentNode.replaceChild(frag, node);
                return;
            }

            // Element node — recurse into children (clone array since
            // the mutation swaps children as we go).
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Skip the decorative terminal mark — it already has
                // its own treatment and doesn't need to be split.
                if (node.classList?.contains("hero__title-mark")) return;
                const children = Array.from(node.childNodes);
                for (const child of children) walk(child);
            }
        };

        walk(line);
        line.classList.add("is-split");
    });
}

/**
 * Hero cold-open teaser — after the title has fully landed (~2.3s in),
 * a single large price materializes, counts the reader from €45
 * (the midnight baseline) down to −€145.12 (the Sunday trough), holds
 * briefly, then fades out. The whole sequence is ~2.2s and plays once
 * per page load.
 *
 * The value tween is cubic-eased so the number doesn't feel like a
 * uniform drop — it accelerates through the negative crossing and
 * slows as it approaches the final reading, echoing a real market
 * moving through a shock.
 */
const COLDOPEN_START_DELAY_MS = 2300;
const COLDOPEN_TWEEN_DELAY_MS = 450;
const COLDOPEN_TWEEN_DUR_MS = 1100;
const COLDOPEN_START_VALUE = 45;
const COLDOPEN_END_VALUE = -145.12;

function setupHeroColdOpen() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = document.querySelector("[data-hero-coldopen]");
    if (!el) return;
    const valueEl = el.querySelector("[data-coldopen-value]");
    if (!valueEl) return;

    // Start at €45 so the first frame the reader sees matches the
    // baseline. The tween kicks in COLDOPEN_TWEEN_DELAY_MS after the
    // element has appeared.
    valueEl.textContent = formatColdOpenValue(COLDOPEN_START_VALUE);

    setTimeout(() => {
        // Force a synchronous reflow so the browser commits the
        // initial opacity: 0 to the paint pipeline BEFORE the class
        // toggle pushes it to opacity: 1. Without this, some browsers
        // batch both states into one paint and the CSS transition
        // never fires (the element jumps from "never rendered" to
        // "fully visible" in a single frame, skipping the 480ms ease).
        void el.offsetWidth;
        el.classList.add("is-showing");
    }, COLDOPEN_START_DELAY_MS);

    setTimeout(() => {
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / COLDOPEN_TWEEN_DUR_MS);
            // easeInOutCubic — accelerates through the zero crossing,
            // decelerates onto the final reading.
            const eased = t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const v = COLDOPEN_START_VALUE + (COLDOPEN_END_VALUE - COLDOPEN_START_VALUE) * eased;
            valueEl.textContent = formatColdOpenValue(v);
            if (v < 0 && !el.classList.contains("is-crashing")) {
                el.classList.add("is-crashing");
            }
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, COLDOPEN_START_DELAY_MS + COLDOPEN_TWEEN_DELAY_MS);

    // No fade-out — the final value sticks so scrolling back to the
    // top of the page finds the teaser still in place. The cold-open
    // becomes a persistent anchor for the hero dispatch.
}

function formatColdOpenValue(value) {
    const abs = Math.abs(value).toFixed(2);
    const sign = value < 0 ? "\u2212" : "";
    return `${sign}\u20AC${abs}`;
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
// Tilt updates are quantized to 0.02 increments so scroll frames that
// compute a near-identical value don't trigger a fresh CSS-variable
// write (and the resulting GPU re-composite of the tilted SVG).
const MAP_TILT_QUANTUM = 0.02;

function setupMapTilt() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scene = document.querySelector(".scene");
    const peakCard = document.querySelector('.step[data-step="3"]');
    if (!scene) return;
    const root = document.documentElement;

    let ticking = false;
    let lastTilt = -1;
    const update = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const vh = window.innerHeight;
            const sceneRect = scene.getBoundingClientRect();

            // Scene hasn't entered the viewport — map is effectively
            // hidden behind the hero. Keep the tilt at 0 so the first
            // reveal lands on a flat plane.
            let tilt;
            if (sceneRect.top > vh * 0.65) {
                tilt = 0;
            } else {
                // Peak target — the tilt crescendoes when the peak
                // card (Step 3) is centered in the viewport. That's
                // the beat where CH drops below DE in the copy.
                tilt = 0.2; // baseline entry tilt once scene is visible
                if (peakCard) {
                    const peakRect = peakCard.getBoundingClientRect();
                    const peakCenter = peakRect.top + peakRect.height / 2;
                    const distFromMid = Math.abs(peakCenter - vh * 0.5);
                    const proximity = Math.max(0, 1 - distFromMid / (vh * 0.6));
                    tilt = Math.max(tilt, proximity * MAP_TILT_MAX);
                }
                if (sceneRect.bottom < vh * 0.9 && sceneRect.bottom > 0) {
                    tilt = Math.max(tilt, MAP_TILT_EXPLORER);
                }
            }

            const quantized = Math.round(tilt / MAP_TILT_QUANTUM) * MAP_TILT_QUANTUM;
            if (quantized !== lastTilt) {
                lastTilt = quantized;
                root.style.setProperty("--map-tilt", quantized.toFixed(2));
            }
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
    // Quantize progress so near-identical scroll positions don't
    // trigger redundant style writes. 60 steps ≈ 1.5% of the hero
    // range, fine enough for smooth parallax but coarse enough to
    // elide most scroll events once the hero has fully cleared.
    let lastProgressStep = -1;
    const onScroll = () => {
        if (!armed) return;
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const viewport = window.innerHeight;
            const progress = Math.min(1, Math.max(0, window.scrollY / (viewport * 0.85)));
            const step = Math.round(progress * 60);
            if (step === lastProgressStep) {
                ticking = false;
                return;
            }
            lastProgressStep = step;

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
            // Note: handler stays attached so scrolling back up to
            // the hero re-runs the transforms in reverse and the
            // title/lede/tape all reappear. Early detach caused a
            // regression where the hero stayed invisible forever.
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
