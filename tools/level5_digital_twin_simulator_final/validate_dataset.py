#!/usr/bin/env python3
import argparse
from pathlib import Path
import pandas as pd
import numpy as np

POINTS = {
    "SAT-501A": (-5, 40),
    "AF-501A": (0, 12),
    "FS-501A": (0, 1),
    "SAT-504": (-5, 40),
    "AF-504": (0, 12),
    "DP-504": (0, 100),
    "SAT-507": (-5, 40),
    "AF-507": (0, 12),
    "S-L5-008-TEMP": (10, 35),
    "S-L5-008-HUM": (20, 80),
    "S-L5-008-CO2": (350, 2000),
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    args = ap.parse_args()
    path = Path(args.csv)
    df = pd.read_csv(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="raise")

    problems = []
    if df["timestamp"].duplicated().any():
        problems.append("Duplicate timestamps found.")
    diffs = df["timestamp"].diff().dropna()
    if not (diffs == pd.Timedelta(minutes=1)).all():
        problems.append("Timestamps are not consistently one minute apart.")
    if df[list(POINTS)].isna().any().any():
        problems.append("Missing values found in measurement columns.")
    if "is_anomaly" in df and not (df["is_anomaly"] == 0).all():
        problems.append("Normal dataset contains non-zero anomaly labels.")

    for col, (lo, hi) in POINTS.items():
        if col not in df:
            problems.append(f"Missing column: {col}")
            continue
        if ((df[col] < lo) | (df[col] > hi)).any():
            problems.append(f"{col} contains values outside broad validation bounds {lo}..{hi}.")

    # Internal consistency check for the one asset that has explicit fan status.
    fan_off = df["FS-501A"] < 0.5
    if fan_off.any() and (df.loc[fan_off, "AF-501A"] > 0.20).mean() > 0.01:
        problems.append("HRU501A fan-off rows frequently have non-negligible air velocity.")

    print(f"Rows: {len(df):,}")
    print(f"Start: {df['timestamp'].iloc[0]}")
    print(f"End:   {df['timestamp'].iloc[-1]}")
    print()
    print(df[list(POINTS)].describe().T[["min", "mean", "max"]].round(2).to_string())
    print()
    if problems:
        print("VALIDATION: FAILED")
        for p in problems:
            print(" -", p)
        raise SystemExit(1)
    print("VALIDATION: PASSED")

if __name__ == "__main__":
    main()
