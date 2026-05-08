"""
convert.py
----------
Reads all 6 TikTok Studio Excel exports + manual screenshot data,
outputs stats/data.json that the dashboard fetches.

USAGE:
    1. Replace any of the .xlsx files in this folder with fresh exports.
    2. Update SCREENSHOT_DATA below if Traffic Source / Viewer demos / Follower age changed.
    3. Run:  python convert.py
    4. Commit + push.

Files expected (next to this script):
    Overview.xlsx
    Viewers.xlsx
    FollowerHistory.xlsx
    FollowerActivity.xlsx
    FollowerGender.xlsx
    FollowerTopTerritories.xlsx
"""

import json
import os
from datetime import datetime, timedelta

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "stats", "data.json")

# -----------------------------------------------------------------------------
# Data NOT exported by TikTok Studio — update these manually from screenshots.
# -----------------------------------------------------------------------------
SCREENSHOT_DATA = {
    # From Overview screenshot — Traffic Source panel
    "trafficSource": [
        {"label": "For You",          "value": 55.2},
        {"label": "Personal profile", "value": 28.4},
        {"label": "Search",           "value": 15.2},
        {"label": "Following",        "value":  0.8},
        {"label": "Sound",            "value":  0.4},
    ],

    # From Viewers screenshot
    "viewerGender": [
        {"label": "Female", "value": 92},
        {"label": "Male",   "value":  6},
        {"label": "Other",  "value":  2},
    ],
    "viewerAge": [
        {"label": "18-24", "value": 45.2},
        {"label": "25-34", "value": 39.7},
        {"label": "35-44", "value":  9.1},
        {"label": "45-54", "value":  4.2},
        {"label": "55+",   "value":  1.8},
    ],
    "viewerLocations": [
        {"code": "US",     "label": "United States",  "value": 50.8},
        {"code": "CA",     "label": "Canada",         "value": 14.0},
        {"code": "AU",     "label": "Australia",      "value":  8.5},
        {"code": "GB",     "label": "United Kingdom", "value":  5.7},
        {"code": "NZ",     "label": "New Zealand",    "value":  2.1},
        {"code": "IE",     "label": "Ireland",        "value":  1.9},
        {"code": "ZA",     "label": "South Africa",   "value":  1.7},
        {"code": "NL",     "label": "Netherlands",    "value":  1.5},
        {"code": "FI",     "label": "Finland",        "value":  1.1},
        {"code": "NO",     "label": "Norway",         "value":  0.9},
        {"code": "Others", "label": "Others",         "value": 11.8},
    ],

    # From Followers screenshot — Age (gender + locations come from Excels)
    "followerAge": [
        {"label": "18-24", "value": 30.6},
        {"label": "25-34", "value": 44.6},
        {"label": "35-44", "value": 16.5},
        {"label": "45-54", "value":  5.9},
        {"label": "55+",   "value":  2.4},
    ],
}

# Map ISO country code → human-readable name (for FollowerTopTerritories)
COUNTRY_NAMES = {
    "US": "United States", "GB": "United Kingdom", "CA": "Canada",
    "AU": "Australia", "NL": "Netherlands", "DE": "Germany",
    "IE": "Ireland", "SE": "Sweden", "NZ": "New Zealand",
    "PL": "Poland", "ZA": "South Africa", "FR": "France",
    "ES": "Spain", "IT": "Italy", "BR": "Brazil", "MX": "Mexico",
    "JP": "Japan", "KR": "South Korea", "IN": "India",
    "Others": "Others",
}


def parse_dates(date_strs, latest_is_today=True):
    """
    TikTok exports show 'May 6' style with no year. We assume the LAST row in
    the file is the most recent date (i.e. 'today' or yesterday) and walk
    backward — flipping the year when the month resets going backward.
    Returns ISO date strings in the same order as the input.
    """
    today = datetime.now()
    # Parse each label as a (month, day) and assign a year by walking backwards.
    # We prepend a placeholder year ("1900") to avoid the Python 3.12+
    # DeprecationWarning about year-less date parsing — we discard the year and
    # assign the real one ourselves below.
    parsed = []
    for s in date_strs:
        s = str(s).strip()
        dt = None
        for fmt in ("%Y %b %d", "%Y %B %d"):
            try:
                dt = datetime.strptime("1900 " + s, fmt)
                break
            except ValueError:
                continue
        if dt is None:
            raise ValueError(f"Could not parse date: {s!r}")
        parsed.append((dt.month, dt.day))

    # Walk backwards from the last entry, assigning years.
    n = len(parsed)
    years = [None] * n
    cur_year = today.year
    last_month = parsed[-1][0]
    # Make sure final entry's month is at-or-before today's month in current year
    if parsed[-1] > (today.month, today.day):
        cur_year -= 1
    years[-1] = cur_year
    for i in range(n - 2, -1, -1):
        m = parsed[i][0]
        if m > last_month:  # month increased going backwards → previous year
            cur_year -= 1
        years[i] = cur_year
        last_month = m

    return [
        f"{y:04d}-{m:02d}-{d:02d}"
        for (m, d), y in zip(parsed, years)
    ]


def overview_data():
    df = pd.read_excel(os.path.join(HERE, "Overview.xlsx"))
    iso = parse_dates(df["Date"].tolist())
    rows = []
    for i, date in enumerate(iso):
        rows.append({
            "date": date,
            "videoViews":   int(df["Video Views"].iloc[i] or 0),
            "profileViews": int(df["Profile Views"].iloc[i] or 0),
            "likes":        int(df["Likes"].iloc[i] or 0),
            "comments":     int(df["Comments"].iloc[i] or 0),
            "shares":       int(df["Shares"].iloc[i] or 0),
        })
    return rows


def viewers_data():
    df = pd.read_excel(os.path.join(HERE, "Viewers.xlsx"))
    iso = parse_dates(df["Date"].tolist())
    rows = []
    for i, date in enumerate(iso):
        # 'Total Viewers' may include strings — coerce
        try:
            total = int(df["Total Viewers"].iloc[i])
        except (ValueError, TypeError):
            total = 0
        rows.append({
            "date": date,
            "totalViewers":     total,
            "newViewers":       int(df["New Viewers"].iloc[i] or 0),
            "returningViewers": int(df["Returning Viewers"].iloc[i] or 0),
        })
    return rows


def follower_history_data():
    df = pd.read_excel(os.path.join(HERE, "FollowerHistory.xlsx"))
    iso = parse_dates(df["Date"].tolist())
    rows = []
    for i, date in enumerate(iso):
        rows.append({
            "date": date,
            "followers": int(df["Followers"].iloc[i] or 0),
            "delta":     int(df["Difference in followers from previous day"].iloc[i] or 0),
        })
    return rows


def follower_activity_data():
    """Average active followers by hour-of-day, across all dates in file."""
    df = pd.read_excel(os.path.join(HERE, "FollowerActivity.xlsx"))
    avg_by_hour = (
        df.groupby("Hour")["Active followers"]
        .mean()
        .round()
        .astype(int)
        .reset_index()
        .sort_values("Hour")
    )
    return [
        {"hour": int(r["Hour"]), "active": int(r["Active followers"])}
        for _, r in avg_by_hour.iterrows()
    ]


def follower_gender_data():
    df = pd.read_excel(os.path.join(HERE, "FollowerGender.xlsx"))
    return [
        {"label": str(r["Gender"]), "value": round(float(r["Distribution"]) * 100, 1)}
        for _, r in df.iterrows()
    ]


def follower_territories_data():
    df = pd.read_excel(os.path.join(HERE, "FollowerTopTerritories.xlsx"))
    out = []
    for _, r in df.iterrows():
        code = str(r["Top territories"])
        out.append({
            "code":  code,
            "label": COUNTRY_NAMES.get(code, code),
            "value": round(float(r["Distribution"]) * 100, 1),
        })
    return out


def main():
    overview = overview_data()
    viewers = viewers_data()
    history = follower_history_data()

    data = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "overview": overview,
        "viewers": viewers,
        "followerHistory": history,
        "followerActivity": follower_activity_data(),
        "followerGender": follower_gender_data(),
        "followerTerritories": follower_territories_data(),
        **SCREENSHOT_DATA,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, indent=2)

    # Summary
    print(f"✓ Wrote {OUT}")
    print(f"  Overview:        {len(overview):>3} days  ({overview[0]['date']} → {overview[-1]['date']})")
    print(f"  Viewers:         {len(viewers):>3} days  ({viewers[0]['date']} → {viewers[-1]['date']})")
    print(f"  FollowerHistory: {len(history):>3} days  ({history[0]['date']} → {history[-1]['date']})")
    print(f"  Latest followers: {history[-1]['followers']:,}")


if __name__ == "__main__":
    main()
