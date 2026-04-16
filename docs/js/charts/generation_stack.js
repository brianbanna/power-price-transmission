// Generation stack chart — stacked area showing hourly generation by
// source for one country on one day, with a price line overlay on a
// secondary y-axis and a dashed total-load reference line.
//
// Usage:
//   const gs = createGenerationStack("#container", {
//       series,     // array of 24 hourly records from showcase_day.json
//       country,    // ISO code (for the title)
//       label,      // display label e.g. "Germany — 12 May 2024"
//   });
//   gs.reveal();   // animate the clip-path open
//   gs.destroy();

import * as d3 from "d3";
import { GENERATION_COLORS } from "../utils/colors.js";

const MARGIN = { top: 24, right: 54, bottom: 34, left: 52 };
const WIDTH = 400;
const HEIGHT = 240;
const INNER_W = WIDTH - MARGIN.left - MARGIN.right;
const INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom;

// Stack order, bottom to top. Only keys with non-zero values in the
// series will produce visible bands; the rest collapse to zero-height.
const STACK_KEYS = ["solar", "wind", "hydro", "nuclear", "gas"];

const SOURCE_LABELS = {
    solar: "Solar",
    wind: "Wind",
    hydro: "Hydro",
    nuclear: "Nuclear",
    gas: "Gas",
};

export function createGenerationStack(selector, config) {
    const container =
        typeof selector === "string"
            ? document.querySelector(selector)
            : selector;
    if (!container) return null;

    const { series, label } = config;
    if (!series?.length) {
        const empty = document.createElement("p");
        empty.className = "chart-empty mono";
        empty.textContent = "No data available";
        container.appendChild(empty);
        return { el: empty, reveal: () => {}, destroy: () => empty.remove() };
    }

    // Prepare the data for d3.stack — each record needs all keys,
    // defaulting to 0 for missing fields.
    const data = series.map((d) => {
        const row = { hour: d.hour, price: d.price };
        for (const k of STACK_KEYS) row[k] = d[k] || 0;
        row._total = STACK_KEYS.reduce((s, k) => s + row[k], 0);
        return row;
    });

    const stacked = d3.stack().keys(STACK_KEYS)(data);

    // Wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "gen-stack";

    // Title
    const titleEl = document.createElement("p");
    titleEl.className = "gen-stack__title mono";
    titleEl.textContent = label || "Generation mix";
    wrapper.appendChild(titleEl);

    const svg = d3.select(wrapper)
        .append("svg")
        .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
        .attr("class", "gen-stack__svg");

    const g = svg.append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Scales
    const x = d3.scaleLinear()
        .domain([0, 23])
        .range([0, INNER_W]);

    const yMax = d3.max(data, (d) => d._total) * 1.08;
    const y = d3.scaleLinear()
        .domain([0, yMax])
        .range([INNER_H, 0]);

    const priceExtent = d3.extent(data, (d) => d.price);
    const pricePad = Math.max(20, (priceExtent[1] - priceExtent[0]) * 0.12);
    const yPrice = d3.scaleLinear()
        .domain([priceExtent[0] - pricePad, priceExtent[1] + pricePad])
        .range([INNER_H, 0]);

    // Zero-price reference line
    if (yPrice.domain()[0] < 0 && yPrice.domain()[1] > 0) {
        g.append("line")
            .attr("class", "gen-stack__zero")
            .attr("x1", 0).attr("x2", INNER_W)
            .attr("y1", yPrice(0)).attr("y2", yPrice(0));
    }

    // Stacked areas
    const area = d3.area()
        .x((d) => x(d.data.hour))
        .y0((d) => y(d[0]))
        .y1((d) => y(d[1]))
        .curve(d3.curveMonotoneX);

    g.selectAll("path.gen-stack__band")
        .data(stacked)
        .join("path")
        .attr("class", "gen-stack__band")
        .attr("d", area)
        .attr("fill", (d) => GENERATION_COLORS[d.key] || "#64748b")
        .attr("fill-opacity", 0.82);

    // Total load dashed line (sum of generation as demand proxy)
    const loadLine = d3.line()
        .x((d) => x(d.hour))
        .y((d) => y(d._total))
        .curve(d3.curveMonotoneX);

    g.append("path")
        .datum(data)
        .attr("class", "gen-stack__load")
        .attr("d", loadLine);

    // Price line (secondary y-axis)
    const priceLine = d3.line()
        .x((d) => x(d.hour))
        .y((d) => yPrice(d.price))
        .curve(d3.curveMonotoneX);

    g.append("path")
        .datum(data)
        .attr("class", "gen-stack__price")
        .attr("d", priceLine);

    // Axes
    const xAxis = g.append("g")
        .attr("class", "gen-stack__axis gen-stack__axis--x")
        .attr("transform", `translate(0,${INNER_H})`)
        .call(
            d3.axisBottom(x)
                .tickValues([0, 6, 12, 18, 23])
                .tickFormat((h) => `${String(h).padStart(2, "0")}:00`)
                .tickSize(0)
                .tickPadding(8),
        );
    xAxis.select(".domain").remove();

    // Left axis — generation MW
    const yAxisLeft = g.append("g")
        .attr("class", "gen-stack__axis gen-stack__axis--y")
        .call(
            d3.axisLeft(y)
                .ticks(4)
                .tickFormat((v) => `${(v / 1000).toFixed(0)}`)
                .tickSize(-INNER_W)
                .tickPadding(6),
        );
    yAxisLeft.select(".domain").remove();
    yAxisLeft.selectAll(".tick line")
        .attr("stroke", "rgba(255,255,255,0.06)");

    // Left axis label
    g.append("text")
        .attr("class", "gen-stack__axis-label")
        .attr("x", -MARGIN.left + 4)
        .attr("y", -10)
        .text("GW");

    // Right axis — price EUR/MWh
    const yAxisRight = g.append("g")
        .attr("class", "gen-stack__axis gen-stack__axis--y-price")
        .attr("transform", `translate(${INNER_W},0)`)
        .call(
            d3.axisRight(yPrice)
                .ticks(5)
                .tickFormat((v) => `${v >= 0 ? "" : "\u2212"}${Math.abs(v).toFixed(0)}`)
                .tickSize(0)
                .tickPadding(6),
        );
    yAxisRight.select(".domain").remove();

    // Right axis label
    g.append("text")
        .attr("class", "gen-stack__axis-label gen-stack__axis-label--right")
        .attr("x", INNER_W + MARGIN.right - 4)
        .attr("y", -10)
        .attr("text-anchor", "end")
        .text("€/MWh");

    // Legend — small colour dots + labels under the chart
    const legendG = svg.append("g")
        .attr("class", "gen-stack__legend")
        .attr("transform", `translate(${MARGIN.left}, ${HEIGHT - 6})`);

    const activeKeys = STACK_KEYS.filter((k) =>
        data.some((d) => d[k] > 0),
    );
    let lx = 0;
    for (const k of activeKeys) {
        const item = legendG.append("g")
            .attr("transform", `translate(${lx}, 0)`);
        item.append("rect")
            .attr("width", 8).attr("height", 8)
            .attr("rx", 1)
            .attr("fill", GENERATION_COLORS[k]);
        item.append("text")
            .attr("x", 11).attr("y", 7)
            .attr("class", "gen-stack__legend-text")
            .text(SOURCE_LABELS[k] || k);
        lx += (SOURCE_LABELS[k] || k).length * 6 + 22;
    }
    // Price legend dot
    const priceItem = legendG.append("g")
        .attr("transform", `translate(${lx}, 0)`);
    priceItem.append("line")
        .attr("x1", 0).attr("x2", 12)
        .attr("y1", 4).attr("y2", 4)
        .attr("stroke", "var(--accent-glow)")
        .attr("stroke-width", 1.5);
    priceItem.append("text")
        .attr("x", 15).attr("y", 7)
        .attr("class", "gen-stack__legend-text")
        .text("Price");

    // Hover crosshair + tooltip
    wrapper.style.position = "relative";

    const hoverG = g.append("g").attr("class", "gen-stack__hover").style("display", "none");
    hoverG.append("line")
        .attr("class", "gen-stack__crosshair")
        .attr("y1", 0).attr("y2", INNER_H);
    hoverG.append("circle")
        .attr("class", "gen-stack__crosshair-dot")
        .attr("r", 3);

    const tipEl = document.createElement("div");
    tipEl.className = "gen-stack__tip mono";
    tipEl.style.display = "none";
    wrapper.appendChild(tipEl);

    // Invisible overlay to capture mouse events across the full chart area
    svg.append("rect")
        .attr("class", "gen-stack__overlay")
        .attr("x", MARGIN.left).attr("y", MARGIN.top)
        .attr("width", INNER_W).attr("height", INNER_H)
        .attr("fill", "none")
        .attr("pointer-events", "all")
        .on("pointermove", function (event) {
            const [mx] = d3.pointer(event, this);
            const hour = Math.round(x.invert(mx));
            const clamped = Math.max(0, Math.min(23, hour));
            const d = data[clamped];
            if (!d) return;

            hoverG.style("display", null);
            const cx = x(clamped);
            hoverG.select("line").attr("x1", cx).attr("x2", cx);
            hoverG.select("circle").attr("cx", cx).attr("cy", yPrice(d.price));

            const sign = d.price < 0 ? "−" : "";
            const abs = Math.abs(d.price).toFixed(1);
            const lines = [`${String(clamped).padStart(2, "0")}:00  ${sign}€${abs}/MWh`];
            for (const k of STACK_KEYS) {
                if (d[k] > 0) lines.push(`${SOURCE_LABELS[k]}: ${(d[k] / 1000).toFixed(1)} GW`);
            }
            tipEl.innerHTML = lines.join("<br>");
            tipEl.style.display = "";

            // Position tooltip near the crosshair, clamped to wrapper bounds
            const svgRect = svg.node().getBoundingClientRect();
            const wrapRect = wrapper.getBoundingClientRect();
            const tipX = (cx + MARGIN.left) * (svgRect.width / WIDTH);
            const maxRight = Math.min(wrapRect.width, window.innerWidth - wrapRect.left) - 160;
            tipEl.style.left = `${Math.min(maxRight, Math.max(0, tipX - 60))}px`;
            const isTouch = d3.select(this).node()?.closest && (event?.pointerType === "touch");
            tipEl.style.top = isTouch ? "0px" : `${MARGIN.top - 8}px`;
        })
        .on("pointerleave", function () {
            hoverG.style("display", "none");
            tipEl.style.display = "none";
        });

    // Clip path for animated reveal — starts fully clipped and
    // reveal() transitions to full width over 1.2s.
    const clipId = `gen-clip-${Math.random().toString(36).slice(2, 8)}`;
    svg.append("defs").append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("class", "gen-stack__clip-rect")
        .attr("x", 0).attr("y", 0)
        .attr("width", 0)
        .attr("height", HEIGHT);
    g.attr("clip-path", `url(#${clipId})`);

    container.appendChild(wrapper);

    function reveal() {
        svg.select(".gen-stack__clip-rect")
            .transition()
            .duration(1200)
            .ease(d3.easeCubicInOut)
            .attr("width", WIDTH);
    }

    function destroy() {
        wrapper.remove();
    }

    return { el: wrapper, reveal, destroy };
}
