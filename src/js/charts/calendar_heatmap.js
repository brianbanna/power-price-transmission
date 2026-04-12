// Calendar heatmap — renders a dense hour × day grid of electricity
// prices for a single country. Canvas-backed for performance (~13K
// cells). D3 scales drive the layout maths; thin DOM elements handle
// the axes and tooltip.
//
// Usage:
//   const hm = createCalendarHeatmap("#container", {
//       data,          // the full calendar_heatmap.json object
//       country: "DE", // "CH" or "DE"
//       label: "Germany",
//   });
//   hm.destroy();

import { priceContinuous } from "../utils/colors.js";

// Layout constants — tuned for the ~460px narrative card width.
const CELL_W = 13;
const CELL_H = 1.0;
const MONTH_GAP = 4;
const MARGIN = { top: 32, right: 8, bottom: 20, left: 44 };
const HOUR_LABELS = [0, 6, 12, 18, 23];

export function createCalendarHeatmap(selector, config) {
    const container =
        typeof selector === "string"
            ? document.querySelector(selector)
            : selector;
    if (!container) return null;

    const { data, country, label } = config;
    if (!data?.days?.length) return null;

    // Filter to days that have data for this country and are full
    // (skip the final partial day if it only has 1 hour).
    const days = data.days.filter(
        (d) => d[country]?.length >= 23,
    );

    // Group days by month for the y-axis gap insertion.
    const months = [];
    let currentMonth = null;
    let yOffset = 0;
    for (const day of days) {
        const m = day.date.slice(0, 7); // "2024-01"
        if (m !== currentMonth) {
            if (currentMonth !== null) yOffset += MONTH_GAP;
            months.push({ key: m, startY: yOffset, startIdx: months.length ? days.indexOf(day) : 0 });
            currentMonth = m;
        }
        day._y = yOffset;
        yOffset += CELL_H;
    }

    const gridW = 24 * CELL_W;
    const gridH = yOffset;
    const totalW = MARGIN.left + gridW + MARGIN.right;
    const totalH = MARGIN.top + gridH + MARGIN.bottom;

    // Wrapper div for the whole chart.
    const wrapper = document.createElement("div");
    wrapper.className = "cal-heatmap";
    wrapper.style.width = `${totalW}px`;
    wrapper.style.position = "relative";

    // Country label above the chart.
    const titleEl = document.createElement("p");
    titleEl.className = "cal-heatmap__title mono";
    titleEl.textContent = label || country;
    wrapper.appendChild(titleEl);

    // Canvas for the grid cells.
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.className = "cal-heatmap__canvas";
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    wrapper.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Draw every cell.
    for (const day of days) {
        const prices = day[country];
        const y0 = MARGIN.top + day._y;
        for (let h = 0; h < prices.length && h < 24; h++) {
            ctx.fillStyle = priceContinuous(prices[h]);
            ctx.fillRect(
                MARGIN.left + h * CELL_W,
                y0,
                CELL_W - 0.5,
                Math.max(CELL_H, 1),
            );
        }
    }

    // Hour axis labels (top).
    const hourRow = document.createElement("div");
    hourRow.className = "cal-heatmap__hours mono";
    hourRow.style.left = `${MARGIN.left}px`;
    hourRow.style.width = `${gridW}px`;
    for (const h of HOUR_LABELS) {
        const span = document.createElement("span");
        span.className = "cal-heatmap__hour-label";
        span.textContent = String(h).padStart(2, "0");
        span.style.left = `${(h / 23) * 100}%`;
        hourRow.appendChild(span);
    }
    wrapper.appendChild(hourRow);

    // Month labels (left side).
    const monthCol = document.createElement("div");
    monthCol.className = "cal-heatmap__months mono";
    monthCol.style.top = `${MARGIN.top}px`;
    const MONTH_NAMES = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    for (const m of months) {
        const [, mm] = m.key.split("-");
        const span = document.createElement("span");
        span.className = "cal-heatmap__month-label";
        span.textContent = MONTH_NAMES[parseInt(mm, 10) - 1];
        span.style.top = `${m.startY}px`;
        monthCol.appendChild(span);
    }
    wrapper.appendChild(monthCol);

    // Tooltip — shows date, hour, and price on hover. Hit-testing is
    // simple arithmetic: mouse position → (hour, dayIndex) via the
    // known cell dimensions and month-gap offsets.
    const tip = document.createElement("div");
    tip.className = "cal-heatmap__tip mono";
    tip.style.display = "none";
    wrapper.appendChild(tip);

    const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left - MARGIN.left;
        const my = e.clientY - rect.top - MARGIN.top;
        if (mx < 0 || mx >= gridW || my < 0 || my >= gridH) {
            tip.style.display = "none";
            return;
        }
        const hour = Math.min(23, Math.floor(mx / CELL_W));
        // Binary search for the day at this y coordinate.
        let lo = 0;
        let hi = days.length - 1;
        let dayIdx = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const dy = days[mid]._y;
            if (my >= dy && my < dy + CELL_H) { dayIdx = mid; break; }
            if (my < dy) hi = mid - 1; else lo = mid + 1;
        }
        if (dayIdx < 0) { tip.style.display = "none"; return; }
        const day = days[dayIdx];
        const price = day[country]?.[hour];
        if (price == null) { tip.style.display = "none"; return; }
        const sign = price < 0 ? "\u2212" : "";
        const abs = Math.abs(price).toFixed(1);
        tip.textContent = `${day.date} ${String(hour).padStart(2, "0")}:00  ${sign}\u20AC${abs}`;
        tip.style.display = "";
        // Position the tooltip above the cursor, clamped to the wrapper.
        const tx = Math.min(totalW - 140, Math.max(0, mx + MARGIN.left - 60));
        const ty = Math.max(0, my + MARGIN.top - 24);
        tip.style.left = `${tx}px`;
        tip.style.top = `${ty}px`;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", () => { tip.style.display = "none"; });

    container.appendChild(wrapper);

    function destroy() {
        canvas.removeEventListener("pointermove", onMove);
        wrapper.remove();
    }

    return { el: wrapper, destroy };
}
