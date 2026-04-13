// Daily profile chart — a 24-hour line chart showing the average
// hourly price profile for a country. Supports:
//   - Monthly animation (Step 6 duck curve)
//   - Ghost overlay of the annual average or a comparison month
//   - Small-multiple mode for Step 7 (compact, no axes)
//
// Usage:
//   const dp = createDailyProfile("#container", {
//       profiles,       // the country object from daily_profiles.json
//       country: "DE",
//       label: "Germany",
//       compact: false,  // true = small-multiple mode
//       width: 380,
//       height: 200,
//   });
//   dp.setMonth("2024-05");
//   dp.animateMonths(months, intervalMs);
//   dp.destroy();

import * as d3 from "d3";

const FULL_MARGIN = { top: 20, right: 48, bottom: 28, left: 44 };
const COMPACT_MARGIN = { top: 12, right: 6, bottom: 18, left: 6 };

export function createDailyProfile(selector, config) {
    const container =
        typeof selector === "string"
            ? document.querySelector(selector)
            : selector;
    if (!container) return null;

    const {
        profiles,
        country = "DE",
        label = "",
        compact = false,
        width = compact ? 160 : 380,
        height = compact ? 100 : 200,
    } = config;

    if (!profiles?.annual_average) return null;

    const margin = compact ? COMPACT_MARGIN : FULL_MARGIN;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const wrapper = document.createElement("div");
    wrapper.className = `daily-profile${compact ? " daily-profile--compact" : ""}`;

    if (label) {
        const titleEl = document.createElement("p");
        titleEl.className = "daily-profile__title mono";
        titleEl.textContent = label;
        wrapper.appendChild(titleEl);
    }

    const svg = d3.select(wrapper)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("class", "daily-profile__svg");

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales
    const x = d3.scaleLinear().domain([0, 23]).range([0, innerW]);

    // Compute global y extent across all months + annual for stable axis.
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const v of profiles.annual_average) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
    }
    for (const m of Object.values(profiles.monthly)) {
        for (const v of m) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
        }
    }
    const yPad = Math.max(10, (yMax - yMin) * 0.1);
    const y = d3.scaleLinear()
        .domain([yMin - yPad, yMax + yPad])
        .range([innerH, 0]);

    // Zero line
    if (y.domain()[0] < 0 && y.domain()[1] > 0) {
        g.append("line")
            .attr("class", "daily-profile__zero")
            .attr("x1", 0).attr("x2", innerW)
            .attr("y1", y(0)).attr("y2", y(0));
    }

    const lineGen = d3.line()
        .x((_, i) => x(i))
        .y((d) => y(d))
        .curve(d3.curveMonotoneX);

    const areaGen = d3.area()
        .x((_, i) => x(i))
        .y0(() => y(Math.max(y.domain()[0], Math.min(0, y.domain()[1]))))
        .y1((d) => y(d))
        .curve(d3.curveMonotoneX);

    // Ghost line (annual average) — always visible as reference.
    g.append("path")
        .datum(profiles.annual_average)
        .attr("class", "daily-profile__ghost")
        .attr("d", lineGen);

    // Active area fill
    const activeFill = g.append("path")
        .attr("class", "daily-profile__area")
        .datum(profiles.annual_average)
        .attr("d", areaGen);

    // Active line
    const activeLine = g.append("path")
        .attr("class", "daily-profile__line")
        .datum(profiles.annual_average)
        .attr("d", lineGen);

    // Month label (top-right corner of chart area)
    const monthLabel = g.append("text")
        .attr("class", "daily-profile__month-label")
        .attr("x", innerW)
        .attr("y", 0)
        .attr("text-anchor", "end")
        .attr("dy", "0.35em")
        .text("Annual avg");

    // Axes (full mode only)
    if (!compact) {
        const xAxis = g.append("g")
            .attr("class", "daily-profile__axis")
            .attr("transform", `translate(0,${innerH})`)
            .call(
                d3.axisBottom(x)
                    .tickValues([0, 6, 12, 18, 23])
                    .tickFormat((h) => `${String(h).padStart(2, "0")}`)
                    .tickSize(0)
                    .tickPadding(6),
            );
        xAxis.select(".domain").remove();

        const yAxis = g.append("g")
            .attr("class", "daily-profile__axis")
            .call(
                d3.axisLeft(y)
                    .ticks(4)
                    .tickFormat((v) => `${v < 0 ? "\u2212" : ""}${Math.abs(v).toFixed(0)}`)
                    .tickSize(-innerW)
                    .tickPadding(4),
            );
        yAxis.select(".domain").remove();
        yAxis.selectAll(".tick line")
            .attr("stroke", "rgba(255,255,255,0.06)");

        g.append("text")
            .attr("class", "daily-profile__axis-label")
            .attr("x", -margin.left + 4)
            .attr("y", -8)
            .text("€/MWh");
    } else {
        // Compact: just country code label at bottom-center
        g.append("text")
            .attr("class", "daily-profile__country-label")
            .attr("x", innerW / 2)
            .attr("y", innerH + 14)
            .attr("text-anchor", "middle")
            .text(country);
    }

    let currentMonth = null;

    // Hover crosshair + tooltip (full mode only)
    if (!compact) {
        wrapper.style.position = "relative";

        const hoverG = g.append("g").attr("class", "daily-profile__hover").style("display", "none");
        hoverG.append("line")
            .attr("class", "daily-profile__crosshair")
            .attr("y1", 0).attr("y2", innerH);
        hoverG.append("circle")
            .attr("class", "daily-profile__crosshair-dot")
            .attr("r", 3);

        const tipEl = document.createElement("div");
        tipEl.className = "daily-profile__tip mono";
        tipEl.style.display = "none";
        wrapper.appendChild(tipEl);

        svg.append("rect")
            .attr("class", "daily-profile__overlay")
            .attr("x", margin.left).attr("y", margin.top)
            .attr("width", innerW).attr("height", innerH)
            .attr("fill", "none")
            .attr("pointer-events", "all")
            .on("pointermove", function (event) {
                const [mx] = d3.pointer(event, this);
                const hour = Math.round(x.invert(mx));
                const clamped = Math.max(0, Math.min(23, hour));

                const currentData = currentMonth
                    ? (profiles.monthly[currentMonth] || profiles.annual_average)
                    : profiles.annual_average;
                const price = currentData[clamped];
                if (price == null) return;

                hoverG.style("display", null);
                const cx = x(clamped);
                hoverG.select("line").attr("x1", cx).attr("x2", cx);
                hoverG.select("circle").attr("cx", cx).attr("cy", y(price));

                const sign = price < 0 ? "\u2212" : "";
                const abs = Math.abs(price).toFixed(1);
                tipEl.textContent = `${String(clamped).padStart(2, "0")}:00  ${sign}\u20AC${abs}/MWh`;
                tipEl.style.display = "";

                const svgRect = svg.node().getBoundingClientRect();
                const wrapRect = wrapper.getBoundingClientRect();
                const tipX = (cx + margin.left) * (svgRect.width / width);
                tipEl.style.left = `${Math.min(wrapRect.width - 120, Math.max(0, tipX - 50))}px`;
                tipEl.style.top = `${margin.top - 8}px`;
            })
            .on("pointerleave", function () {
                hoverG.style("display", "none");
                tipEl.style.display = "none";
            });
    }

    let animTimer = null;

    function setMonth(monthKey) {
        currentMonth = monthKey;
        const data = monthKey
            ? (profiles.monthly[monthKey] || profiles.annual_average)
            : profiles.annual_average;

        activeLine
            .datum(data)
            .transition()
            .duration(400)
            .ease(d3.easeCubicInOut)
            .attr("d", lineGen);

        activeFill
            .datum(data)
            .transition()
            .duration(400)
            .ease(d3.easeCubicInOut)
            .attr("d", areaGen);

        if (monthKey) {
            const [yr, mm] = monthKey.split("-");
            const NAMES = ["Jan","Feb","Mar","Apr","May","Jun",
                           "Jul","Aug","Sep","Oct","Nov","Dec"];
            monthLabel.text(`${NAMES[parseInt(mm, 10) - 1]} ${yr}`);
        } else {
            monthLabel.text("Annual avg");
        }
    }

    function animateMonths(months, intervalMs = 600) {
        stopAnimation();
        let idx = 0;
        setMonth(months[idx]);
        animTimer = setInterval(() => {
            idx += 1;
            if (idx >= months.length) {
                stopAnimation();
                return;
            }
            setMonth(months[idx]);
        }, intervalMs);
    }

    function stopAnimation() {
        if (animTimer) {
            clearInterval(animTimer);
            animTimer = null;
        }
    }

    function destroy() {
        stopAnimation();
        wrapper.remove();
    }

    container.appendChild(wrapper);

    return { el: wrapper, setMonth, animateMonths, stopAnimation, destroy };
}
