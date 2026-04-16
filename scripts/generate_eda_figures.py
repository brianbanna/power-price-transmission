"""
Generate EDA diagrams for the Milestone 2 report.

Produces four publication-quality figures in the project's dark theme:
  1. Negative-price hours bar chart (Section 2.1)
  2. CH vs DE hourly price scatter (Section 2.2)
  3. Duck curve — DE monthly profiles (Section 2.3)
  4. Monthly renewable share by country (Section 2.4)

Usage:
    .venv/bin/python scripts/generate_eda_figures.py
"""

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd

# ---- Paths ----
ROOT = Path(__file__).resolve().parent.parent
RAW_CSV = ROOT / "data" / "entsoe_data_2024_2025.csv"
OUT_DIR = ROOT / "milestone_2" / "figures"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---- Theme (matches the website's dark palette) ----
BG = "#0a0e1a"
SURFACE = "#141827"
TEXT = "#e8eaed"
MUTED = "#8892a4"
ACCENT = "#56d4f5"
ACCENT_DIM = "#22d3ee"
ORANGE = "#f97316"
RED = "#ef4444"
GREEN = "#10b981"
PURPLE = "#a855f7"
INDIGO = "#6366f1"
YELLOW = "#fbbf24"
COUNTRY_COLORS = {"CH": ACCENT, "DE": YELLOW, "FR": PURPLE, "IT": ORANGE, "AT": GREEN}
COUNTRY_NAMES = {"CH": "Switzerland", "DE": "Germany", "FR": "France", "IT": "Italy", "AT": "Austria"}

plt.rcParams.update({
    "figure.facecolor": BG,
    "axes.facecolor": SURFACE,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": TEXT,
    "text.color": TEXT,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "grid.color": "#1e2436",
    "grid.linewidth": 0.6,
    "font.family": "sans-serif",
    "font.size": 11,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "savefig.facecolor": BG,
    "savefig.dpi": 200,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.3,
})

DISPLAY_TZ = "Europe/Berlin"
FOCUS_RAW = ["CH", "DE_LU", "FR", "IT_NORD", "AT"]
RENAME = {"DE_LU": "DE", "IT_NORD": "IT"}


def load():
    df = pd.read_csv(RAW_CSV)
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True).dt.tz_convert(DISPLAY_TZ)
    df = df[df["country"].isin(FOCUS_RAW)].copy()
    df["country"] = df["country"].replace(RENAME)
    return df


# ---- Figure 1: Negative-price hours bar chart ----
def fig_neg_hours(df):
    counts = (
        df[df["price"] < 0]
        .groupby("country")
        .size()
        .reindex(["DE", "FR", "AT", "CH", "IT"], fill_value=0)
    )
    fig, ax = plt.subplots(figsize=(6, 3.5))
    colors = [COUNTRY_COLORS[c] for c in counts.index]
    bars = ax.bar(
        [COUNTRY_NAMES[c] for c in counts.index],
        counts.values,
        color=colors,
        edgecolor="none",
        width=0.6,
        alpha=0.9,
    )
    for bar, val in zip(bars, counts.values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 15,
            f"{val:,}",
            ha="center",
            va="bottom",
            fontsize=11,
            fontweight="bold",
            color=TEXT,
        )
    ax.set_ylabel("Hours with price < 0")
    ax.set_title("Negative-price hours by country, Jan 2024 \u2013 Jun 2025")
    ax.set_ylim(0, counts.max() * 1.18)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))
    ax.grid(axis="y", alpha=0.5)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    out = OUT_DIR / "eda_neg_hours.png"
    fig.savefig(out)
    plt.close(fig)
    print(f"  saved {out.name} ({out.stat().st_size // 1024} KB)")


# ---- Figure 2: CH vs DE scatter ----
def fig_scatter(df):
    ch = df[df["country"] == "CH"][["datetime", "price"]].set_index("datetime")
    de = df[df["country"] == "DE"][["datetime", "price"]].set_index("datetime")
    merged = ch.join(de, lsuffix="_ch", rsuffix="_de").dropna()
    merged["hour"] = merged.index.hour

    fig, ax = plt.subplots(figsize=(5.5, 5.5))
    sc = ax.scatter(
        merged["price_de"],
        merged["price_ch"],
        c=merged["hour"],
        cmap="twilight_shifted",
        s=2,
        alpha=0.4,
        edgecolors="none",
        rasterized=True,
    )
    # Identity line
    lims = [-250, 350]
    ax.plot(lims, lims, color=MUTED, linewidth=0.8, linestyle="--", alpha=0.6)
    ax.set_xlim(lims)
    ax.set_ylim(lims)
    ax.set_xlabel("Germany price (EUR/MWh)")
    ax.set_ylabel("Switzerland price (EUR/MWh)")
    ax.set_title("Hourly prices: Switzerland vs Germany")
    ax.set_aspect("equal")
    ax.grid(True, alpha=0.3)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    cbar = fig.colorbar(sc, ax=ax, pad=0.02, shrink=0.75)
    cbar.set_label("Hour of day", color=MUTED, fontsize=10)
    cbar.ax.yaxis.set_tick_params(color=MUTED)
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color=MUTED, fontsize=9)

    # Annotate correlation
    corr = merged["price_ch"].corr(merged["price_de"])
    ax.text(
        0.04, 0.96,
        f"r = {corr:.3f}",
        transform=ax.transAxes,
        fontsize=12,
        fontweight="bold",
        color=ACCENT,
        va="top",
    )

    out = OUT_DIR / "eda_scatter.png"
    fig.savefig(out)
    plt.close(fig)
    print(f"  saved {out.name} ({out.stat().st_size // 1024} KB)")


# ---- Figure 3: Duck curve (DE monthly profiles) ----
def fig_duck(df):
    de = df[df["country"] == "DE"].copy()
    de["hour"] = de["datetime"].dt.hour
    de["month"] = de["datetime"].dt.to_period("M")

    months_to_show = ["2024-05", "2024-08", "2024-11", "2025-02", "2025-05"]
    cmap = plt.cm.cool
    n = len(months_to_show)

    fig, ax = plt.subplots(figsize=(7, 4))

    # Annual average as reference
    annual = de.groupby("hour")["price"].mean()
    ax.plot(
        annual.index, annual.values,
        color=MUTED, linewidth=1.2, linestyle="--", alpha=0.7,
        label="18-month average",
    )

    for i, m in enumerate(months_to_show):
        sub = de[de["month"].astype(str) == m]
        profile = sub.groupby("hour")["price"].mean()
        color = cmap(i / (n - 1))
        lw = 2.2 if m in ("2024-05", "2025-05") else 1.4
        ax.plot(
            profile.index, profile.values,
            color=color, linewidth=lw, alpha=0.9,
            label=pd.Timestamp(m + "-01").strftime("%b %Y"),
        )

    ax.axhline(0, color=MUTED, linewidth=0.7, linestyle=":")
    ax.set_xlabel("Hour of day (CET)")
    ax.set_ylabel("Average price (EUR/MWh)")
    ax.set_title("Germany\u2019s duck curve is deepening")
    ax.set_xticks([0, 6, 12, 18, 23])
    ax.set_xticklabels(["00", "06", "12", "18", "23"])
    ax.grid(True, alpha=0.3)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="upper left", fontsize=9, framealpha=0.3, edgecolor="none")

    # Annotate the belly
    ax.annotate(
        "Midday\ntrough",
        xy=(13, annual.iloc[13]),
        xytext=(17, annual.iloc[13] - 18),
        fontsize=9,
        color=ACCENT,
        arrowprops=dict(arrowstyle="->", color=ACCENT, lw=1.2),
        ha="center",
    )

    out = OUT_DIR / "eda_duck_curve.png"
    fig.savefig(out)
    plt.close(fig)
    print(f"  saved {out.name} ({out.stat().st_size // 1024} KB)")


# ---- Figure 4: Monthly renewable share ----
def fig_renewable(df):
    ren_cols = ["solar", "wind_onshore", "wind_offshore", "hydro_total"]
    gen_cols = ren_cols + [
        "nuclear", "fossil_gas", "fossil_hard_coal",
        "fossil_brown_coal_lignite", "fossil_oil", "biomass",
    ]

    for c in gen_cols:
        if c not in df.columns:
            df[c] = 0.0

    df["ren"] = df[ren_cols].fillna(0).sum(axis=1)
    df["total"] = df[gen_cols].fillna(0).sum(axis=1)
    df["ren_share"] = df["ren"] / df["total"].replace(0, np.nan)
    df["month"] = df["datetime"].dt.to_period("M")

    fig, ax = plt.subplots(figsize=(7, 3.5))

    for code in ["DE", "AT", "FR", "CH", "IT"]:
        sub = df[df["country"] == code]
        monthly = sub.groupby("month")["ren_share"].mean()
        xs = range(len(monthly))
        ax.plot(
            xs, monthly.values * 100,
            color=COUNTRY_COLORS[code],
            linewidth=1.8,
            label=COUNTRY_NAMES[code],
            alpha=0.9,
        )

    months_labels = df.groupby("month").first().index
    tick_positions = list(range(0, len(months_labels), 3))
    tick_labels = [str(months_labels[i]) for i in tick_positions if i < len(months_labels)]
    ax.set_xticks(tick_positions[:len(tick_labels)])
    ax.set_xticklabels(tick_labels, rotation=30, ha="right", fontsize=9)
    ax.set_ylabel("Renewable share (%)")
    ax.set_title("Monthly renewable generation share by country")
    ax.grid(True, alpha=0.3)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="lower right", fontsize=9, framealpha=0.3, edgecolor="none")
    ax.set_ylim(0, 105)

    out = OUT_DIR / "eda_renewable_share.png"
    fig.savefig(out)
    plt.close(fig)
    print(f"  saved {out.name} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    print("Loading raw CSV...")
    df = load()
    print(f"  {len(df):,} rows for {df['country'].nunique()} countries")
    print("Generating EDA figures...")
    fig_neg_hours(df)
    fig_scatter(df)
    fig_duck(df)
    fig_renewable(df)
    print("Done.")
