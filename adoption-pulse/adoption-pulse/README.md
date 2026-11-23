# BTC adoption pulse / next-ATH model

Page: `/adoption-pulse/` on bakkerstraat.github.io

## Install into the site repo

```
bakkerstraat.github.io/
  .github/workflows/adoption-pulse.yml   <- from this folder's .github/workflows/
  adoption-pulse/
    index.html
    data/adoption_pulse.json             <- rebuilt weekly
    data/etf_holdings.csv                <- appended weekly from Farside flows
    data/manual_anchors.csv              <- optional hand-entered points for data gaps
    scripts/adoption_pulse.py
```

Then go to Actions > "adoption-pulse weekly update" > Run workflow once, so real data
replaces the seed data. After that it runs every Monday.

## Settings

- `ASSUMED_LOW` (workflow env): your assumed cycle bottom. If price closes below it, the observed low takes over.
- `CYCLES` in the script: search windows for past cycle lows and peaks.

## If a source fails

The script keeps going and lists the failure under "Data notes" on the page.
- Coin Metrics API down: Kraken fills price; addresses are carried forward.
- Farside blocked: add rows to `data/etf_holdings.csv` by hand (date, total BTC held by US spot ETFs).
