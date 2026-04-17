// Calendar heatmap — renders a dense hour × day grid of electricity
// prices for one or two countries with a tab toggle. Canvas-backed
// for performance (~13K cells per country). D3 scales drive the
// layout maths; thin DOM elements handle the axes and tooltip.
//
// Usage:
//   const hm = createCalendarHeatmap("#container", {
//       data,                         // calendar_heatmap.json object
//       countries: [                  // one or two entries
//           { code: "DE", label: "Germany — 846 negative hours" },
//           { code: "CH", label: "Switzerland — 529 negative hours" },
//       ],
//   });
//   hm.destroy();

import { priceContinuous } from "../utils/colors.js";

const CELL_W_DEFAULT = 13;
const CELL_W_NARROW = 11;
const CELL_H = 2.0;
const MONTH_GAP = 5;
const MARGIN = { top: 32, right: 8, bottom: 20, left: 44 };
const HOUR_LABELS = [0, 6, 12, 18, 23];
const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function createCalendarHeatmap(selector, config) {
    const container =
        typeof selector === "string"
            ? document.querySelector(selector)
            : selector;
    if (!container) return null;

    const { data, countries } = config;
    if (!data?.days?.length || !countries?.length) {
        const empty = document.createElement("p");
        empty.className = "chart-empty mono";
        empty.textContent = "No data available";
        container.appendChild(empty);
        return { el: empty, switchTo: () => {}, destroy: () => empty.remove() };
    }

    // Responsive cell width: use narrower cells on small containers
    const containerWidth = container.getBoundingClientRect?.().width || 400;
    const CELL_W = containerWidth < 360 ? CELL_W_NARROW : CELL_W_DEFAULT;

    // Wrapper div for the whole component (tabs + chart).
    const wrapper = document.createElement("div");
    wrapper.className = "cal-heatmap";
    wrapper.style.position = "relative";

    // Tab bar (only rendered when there are 2+ countries).
    let activeIdx = 0;
    const tabs = [];
    if (countries.length > 1) {
        const tabBar = document.createElement("div");
        tabBar.className = "cal-heatmap__tabs mono";
        countries.forEach((c, i) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cal-heatmap__tab";
            btn.textContent = c.code;
            btn.setAttribute("aria-label", c.label);
            if (i === 0) btn.classList.add("is-active");
            btn.addEventListener("click", () => switchTo(i));
            tabBar.appendChild(btn);
            tabs.push(btn);
        });
        wrapper.appendChild(tabBar);
    }

    // Title line — updates when switching countries.
    const titleEl = document.createElement("p");
    titleEl.className = "cal-heatmap__title mono";
    titleEl.textContent = countries[0].label;
    wrapper.appendChild(titleEl);

    // Chart holder — contains canvas + overlays, swapped on toggle.
    const chartHolder = document.createElement("div");
    chartHolder.className = "cal-heatmap__holder";
    wrapper.appendChild(chartHolder);

    // Pre-build chart data for each country once.
    const chartDataByIdx = countries.map((c) => prepareChartData(data, c.code));

    // Render the first country.
    let currentChart = null;
    function switchTo(idx) {
        if (currentChart) currentChart.teardown();
        activeIdx = idx;
        tabs.forEach((t, i) => t.classList.toggle("is-active", i === idx));
        titleEl.textContent = countries[idx].label;
        currentChart = renderChart(chartHolder, chartDataByIdx[idx], countries[idx].code);
    }
    switchTo(0);

    container.appendChild(wrapper);

    function destroy() {
        if (currentChart) currentChart.teardown();
        wrapper.remove();
    }

    return { el: wrapper, destroy, switchTo };
}

function prepareChartData(data, country) {
    const days = data.days.filter((d) => d[country]?.length >= 23);
    const months = [];
    let currentMonth = null;
    let yOffset = 0;
    for (const day of days) {
        const m = day.date.slice(0, 7);
        if (m !== currentMonth) {
            if (currentMonth !== null) yOffset += MONTH_GAP;
            months.push({ key: m, startY: yOffset });
            currentMonth = m;
        }
        day[`_y_${country}`] = yOffset;
        yOffset += CELL_H;
    }
    return { days, months, gridH: yOffset };
}

function renderChart(holder, chartData, country) {
    const { days, months, gridH } = chartData;
    // Remove any previous children cleanly.
    while (holder.firstChild) holder.removeChild(holder.firstChild);

    const gridW = 24 * CELL_W;
    const totalW = MARGIN.left + gridW + MARGIN.right;
    const totalH = MARGIN.top + gridH + MARGIN.bottom;

    holder.style.width = `${totalW}px`;

    // Canvas
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.className = "cal-heatmap__canvas";
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    holder.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const yKey = `_y_${country}`;
    for (const day of days) {
        const prices = day[country];
        const y0 = MARGIN.top + day[yKey];
        for (let h = 0; h < prices.length && h < 24; h++) {
            ctx.fillStyle = priceContinuous(prices[h]);
            ctx.fillRect(
                MARGIN.left + h * CELL_W,
                y0,
                CELL_W - 1,
                Math.max(CELL_H, 1),
            );
        }
    }

    // Hour labels (top)
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
    holder.appendChild(hourRow);

    // Month labels (left)
    const monthCol = document.createElement("div");
    monthCol.className = "cal-heatmap__months mono";
    monthCol.style.top = `${MARGIN.top}px`;
    for (const m of months) {
        const [, mm] = m.key.split("-");
        const span = document.createElement("span");
        span.className = "cal-heatmap__month-label";
        span.textContent = MONTH_NAMES[parseInt(mm, 10) - 1];
        span.style.top = `${m.startY}px`;
        monthCol.appendChild(span);
    }
    holder.appendChild(monthCol);

    // Tooltip
    const tip = document.createElement("div");
    tip.className = "cal-heatmap__tip mono";
    tip.style.display = "none";
    holder.appendChild(tip);

    const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left - MARGIN.left;
        const my = e.clientY - rect.top - MARGIN.top;
        if (mx < 0 || mx >= gridW || my < 0 || my >= gridH) {
            tip.style.display = "none";
            return;
        }
        const hour = Math.min(23, Math.floor(mx / CELL_W));
        let lo = 0;
        let hi = days.length - 1;
        let dayIdx = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const dy = days[mid][yKey];
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
        const canvasRect = canvas.getBoundingClientRect();
        const maxTipX = Math.min(totalW - 140, window.innerWidth - canvasRect.left - 140);
        const tx = Math.min(maxTipX, Math.max(0, mx + MARGIN.left - 60));
        const ty = Math.max(0, my + MARGIN.top - 24);
        tip.style.left = `${tx}px`;
        tip.style.top = `${ty}px`;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", () => { tip.style.display = "none"; });

    // Color legend — horizontal gradient bar explaining the price scale
    const legendEl = document.createElement("div");
    legendEl.className = "cal-heatmap__legend mono";
    const gradientBar = document.createElement("div");
    gradientBar.className = "cal-heatmap__legend-bar";
    legendEl.appendChild(gradientBar);
    const labelsRow = document.createElement("div");
    labelsRow.className = "cal-heatmap__legend-labels";
    const stops = [
        { label: "\u2212200" },
        { label: "\u2212100" },
        { label: "0" },
        { label: "75" },
        { label: "150+" },
    ];
    stops.forEach((s) => {
        const span = document.createElement("span");
        span.textContent = s.label;
        labelsRow.appendChild(span);
    });
    legendEl.appendChild(labelsRow);
    holder.appendChild(legendEl);

    function teardown() {
        canvas.removeEventListener("pointermove", onMove);
        while (holder.firstChild) holder.removeChild(holder.firstChild);
    }

    return { teardown };
}
