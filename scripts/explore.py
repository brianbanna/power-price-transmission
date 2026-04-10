"""
One-shot exploratory diagnostic for the ENTSO-E raw dataset.

Answers three questions before the preprocessing pipeline is written:

1. What does the dataset look like — shape, date range, timezone, countries?
2. For each focus country (CH, DE_LU, FR, IT_NORD, AT), which generation
   columns are usable (non-null, non-zero share)?
3. Do the design-spec headline facts match the data we have?

Run from the repo root:

    .venv/bin/python scripts/explore.py
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

RAW_CSV = Path("data/entsoe_data_2024_2025.csv")

# All analyses are anchored in Central European Time — the timezone the
# German and Swiss markets actually trade in. The raw CSV mixes CET/CEST
# offsets, so we parse as UTC and explicitly convert.
DISPLAY_TZ = "Europe/Berlin"

FOCUS_COUNTRIES = ["CH", "DE_LU", "FR", "IT_NORD", "AT"]

# Columns the visualisation cares about — clean names first, then the
# "_*_actual_aggregated_" alternates that appear to be country-specific
# fallbacks.
GENERATION_COLUMNS_PRIMARY = [
    "solar",
    "wind_onshore",
    "wind_offshore",
    "nuclear",
    "hydro_total",
    "hydro_run_of_river_and_poundage",
    "hydro_water_reservoir",
    "hydro_pumped_storage",
    "fossil_gas",
    "fossil_hard_coal",
    "fossil_brown_coal_lignite",
    "fossil_oil",
    "biomass",
    "other",
    "other_renewable",
    "geothermal",
]

GENERATION_COLUMNS_FALLBACK = [
    "_solar_actual_aggregated_",
    "_wind_onshore_actual_aggregated_",
    "_fossil_gas_actual_aggregated_",
    "_fossil_hard_coal_actual_aggregated_",
    "_fossil_brown_coal_lignite_actual_aggregated_",
    "_fossil_oil_actual_aggregated_",
    "_biomass_actual_aggregated_",
    "_hydro_run_of_river_and_poundage_actual_aggregated_",
    "_hydro_water_reservoir_actual_aggregated_",
    "_hydro_pumped_storage_actual_aggregated_",
    "_other_actual_aggregated_",
    "_other_renewable_actual_aggregated_",
]

# Headline facts from the design spec (Section 2, "Showcase day" and
# Section 10, "Key data insights"). These drive the narrative — if any
# disagree with the raw data, the story needs to change before we build.
#
# The peak trough on 2024-05-12 is 13:00 CET, not 11:00. FR actually
# troughs at 14:00 and is still falling at 13:00. Tolerances are tight.
SPEC_FACTS = {
    "CH 2024-05-12 13:00 price ≈ -145 EUR/MWh": ("CH", "2024-05-12 13:00", "price", -145.12, 0.5),
    "DE_LU 2024-05-12 13:00 price ≈ -135 EUR/MWh": ("DE_LU", "2024-05-12 13:00", "price", -135.45, 0.5),
    "AT 2024-05-12 13:00 price ≈ -126 EUR/MWh": ("AT", "2024-05-12 13:00", "price", -126.05, 0.5),
    "FR 2024-05-12 14:00 price ≈ -87 EUR/MWh": ("FR", "2024-05-12 14:00", "price", -87.29, 0.5),
    "IT_NORD 2024-05-12 13:00 price ≈ +5 EUR/MWh": ("IT_NORD", "2024-05-12 13:00", "price", 5.0, 0.5),
    "DE_LU 2024-05-12 13:00 solar ≈ 41,131 MW": ("DE_LU", "2024-05-12 13:00", "solar", 41131, 500),
    "CH 2024-05-12 13:00 solar ≈ 3,264 MW": ("CH", "2024-05-12 13:00", "solar", 3264, 100),
    "CH 2025-05-11 13:00 price ≈ -262 EUR/MWh": ("CH", "2025-05-11 13:00", "price", -262.21, 0.5),
    "DE_LU 2025-05-11 13:00 price ≈ -250 EUR/MWh": ("DE_LU", "2025-05-11 13:00", "price", -250.32, 0.5),
}

NEG_HOUR_TARGETS = {"DE_LU": 846, "CH": 529, "FR": 715, "AT": 584, "IT_NORD": 0}


def section(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def load() -> pd.DataFrame:
    df = pd.read_csv(RAW_CSV)
    # pandas cannot infer a single dtype for a column whose strings carry
    # different UTC offsets (CET vs CEST), so parse via UTC and convert.
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True).dt.tz_convert(DISPLAY_TZ)
    return df


def overview(df: pd.DataFrame) -> None:
    section("1. Dataset overview")
    print(f"rows:      {len(df):,}")
    print(f"columns:   {len(df.columns)}")
    print(f"countries: {df['country'].nunique()} — {sorted(df['country'].unique())}")
    dt = df["datetime"]
    print(f"datetime dtype: {dt.dtype}")
    print(f"date range:     {dt.min()}  →  {dt.max()}")
    print(f"unique hours:   {dt.nunique():,}")

    missing = [c for c in FOCUS_COUNTRIES if c not in set(df["country"].unique())]
    if missing:
        print(f"WARNING: focus countries missing from data: {missing}")
    else:
        print(f"focus countries all present: {FOCUS_COUNTRIES}")


def price_summary(df: pd.DataFrame) -> None:
    section("2. Price summary per focus country")
    rows = []
    for c in FOCUS_COUNTRIES:
        sub = df[df["country"] == c]["price"]
        rows.append({
            "country": c,
            "n": len(sub),
            "nulls": sub.isna().sum(),
            "min": sub.min(),
            "p05": sub.quantile(0.05),
            "median": sub.median(),
            "p95": sub.quantile(0.95),
            "max": sub.max(),
            "mean": sub.mean(),
            "neg_hours": (sub < 0).sum(),
        })
    print(pd.DataFrame(rows).to_string(index=False))


def generation_fill_rates(df: pd.DataFrame) -> None:
    section("3. Generation column fill rates per focus country")
    print("Share of non-null values (%) — columns with 0% are unusable for that country.")
    print()

    all_cols = GENERATION_COLUMNS_PRIMARY + GENERATION_COLUMNS_FALLBACK
    rows = []
    for c in FOCUS_COUNTRIES:
        sub = df[df["country"] == c]
        n = len(sub)
        row = {"country": c}
        for col in all_cols:
            if col not in sub.columns:
                row[col] = None
            else:
                row[col] = round(100 * sub[col].notna().sum() / n, 1)
        rows.append(row)

    fill = pd.DataFrame(rows).set_index("country").T
    # Only print rows where at least one focus country has a non-zero fill rate
    keep = fill[(fill.fillna(0) > 0).any(axis=1)]
    print(keep.to_string())


def _num(row: pd.Series, col: str) -> float:
    """Read a numeric cell, treating missing / NaN / absent column as 0."""
    if col not in row.index:
        return 0.0
    val = row[col]
    return 0.0 if pd.isna(val) else float(val)


def renewable_share_check(df: pd.DataFrame) -> None:
    section("4. Renewable share — sample at 2024-05-12 13:00")
    ts = pd.Timestamp("2024-05-12 13:00", tz=DISPLAY_TZ)
    for c in FOCUS_COUNTRIES:
        sub = df[(df["country"] == c) & (df["datetime"] == ts)]
        if sub.empty:
            print(f"  {c}: no row at {ts}")
            continue
        row = sub.iloc[0]
        sources = {
            "solar": _num(row, "solar"),
            "wind_on": _num(row, "wind_onshore"),
            "wind_off": _num(row, "wind_offshore"),
            "hydro": _num(row, "hydro_total"),
            "nuclear": _num(row, "nuclear"),
            "gas": _num(row, "fossil_gas"),
        }
        renewable = sources["solar"] + sources["wind_on"] + sources["wind_off"] + sources["hydro"]
        total_known = sum(sources.values())
        price = row["price"]
        share = (renewable / total_known * 100) if total_known else float("nan")
        print(
            f"  {c:7s}  price={price:8.2f}  solar={sources['solar']:8.0f}  "
            f"wind={sources['wind_on']+sources['wind_off']:7.0f}  "
            f"hydro={sources['hydro']:7.0f}  nuclear={sources['nuclear']:7.0f}  "
            f"gas={sources['gas']:6.0f}  → renewable share of known gen: {share:5.1f}%"
        )


def headline_facts(df: pd.DataFrame) -> None:
    section("5. Spec headline facts vs raw data")
    for label, (country, ts_str, col, expected, tolerance) in SPEC_FACTS.items():
        ts = pd.Timestamp(ts_str, tz=DISPLAY_TZ)
        sub = df[(df["country"] == country) & (df["datetime"] == ts)]
        if sub.empty:
            print(f"  [MISS] {label}  — no row found")
            continue
        actual = sub.iloc[0][col]
        if pd.isna(actual):
            print(f"  [NULL] {label}  — column '{col}' is NaN")
            continue
        diff = actual - expected
        verdict = "OK  " if abs(diff) <= tolerance else "FAIL"
        print(f"  [{verdict}] {label}")
        print(f"          expected≈{expected:>8.1f}  actual={actual:>8.1f}  diff={diff:+.1f}")


def negative_hour_counts(df: pd.DataFrame) -> None:
    section("6. Negative-price hour counts per focus country")
    print("Spec targets are from the design doc — confirm they match the data.")
    print()
    for c in FOCUS_COUNTRIES:
        actual = ((df["country"] == c) & (df["price"] < 0)).sum()
        target = NEG_HOUR_TARGETS.get(c)
        if target is None:
            print(f"  {c:7s}  actual={actual:4d}  target=—")
        else:
            diff = actual - target
            ok = "OK  " if abs(diff) <= max(20, target * 0.05) else "CHECK"
            print(f"  {c:7s}  actual={actual:4d}  target={target:4d}  diff={diff:+d}  [{ok}]")


def ch_de_correlation(df: pd.DataFrame) -> None:
    section("7. CH ↔ DE_LU negative-price coincidence")
    ch = df[df["country"] == "CH"][["datetime", "price"]].rename(columns={"price": "ch_price"})
    de = df[df["country"] == "DE_LU"][["datetime", "price"]].rename(columns={"price": "de_price"})
    m = ch.merge(de, on="datetime", how="inner")
    ch_neg = m["ch_price"] < 0
    de_neg = m["de_price"] < 0
    ch_total = int(ch_neg.sum())
    both = int((ch_neg & de_neg).sum())
    share = (100 * both / ch_total) if ch_total else 0.0
    print(f"  CH negative hours:          {ch_total}")
    print(f"  both CH and DE_LU negative: {both}")
    print(f"  share of CH neg hours that coincide with DE_LU neg: {share:.1f}%")
    print("  design-spec claim: 89%")


def main() -> None:
    df = load()
    overview(df)
    price_summary(df)
    generation_fill_rates(df)
    renewable_share_check(df)
    headline_facts(df)
    negative_hour_counts(df)
    ch_de_correlation(df)
    print()
    print("Done.")


if __name__ == "__main__":
    main()
