# Google Projections Sheet (All Supported Sports)

This template is designed for the sports currently supported in the Upside Engine adapters:

- NFL
- NBA
- MLB
- MMA
- Golf
- NASCAR

## 1) Create sheet tabs

Create a new Google Sheet and add these tabs:

1. `README`
2. `LOOKUPS`
3. `RAW_NFL`
4. `RAW_NBA`
5. `RAW_MLB`
6. `RAW_MMA`
7. `RAW_GOLF`
8. `RAW_NASCAR`
9. `PROJECTIONS_ALL`

---

## 2) LOOKUPS tab

In `LOOKUPS!A1:D1` set headers:

- `sport`
- `default_floor_mult`
- `default_ceiling_mult`
- `default_bust_base`

Add rows:

- `nfl | 0.70 | 1.35 | 32`
- `nba | 0.72 | 1.32 | 30`
- `mlb | 0.62 | 1.55 | 40`
- `mma | 0.50 | 1.80 | 45`
- `golf | 0.68 | 1.40 | 34`
- `nascar | 0.58 | 1.65 | 42`

---

## 3) Raw tab schema (repeat for each RAW_* tab)

Use the same headers in row 1 for every `RAW_*` tab:

`player_name,team,position,salary,projection,ownership,minutes,usage,target_share,rush_share,lineup_spot,power,strikeouts,innings,finish_odds_proxy,volume_proxy,underdog_flag,cut_made_proxy,birdie_upside,finishing_ceiling,dominator,place_differential,finish_projection,wreck_risk,source_url,updated_at`

Notes:
- Fill only the columns relevant to each sport.
- Keep unused columns blank.
- `projection` and `salary` are required for scoring output.

---

## 4) PROJECTIONS_ALL tab headers

Set `PROJECTIONS_ALL!A1:W1` to:

`sport,player_name,team,position,salary,projection,ownership,value,floor,ceiling,boom_pct,bust_pct,volatility,game_script_fit,minutes,usage,target_share,rush_share,lineup_spot,power,strikeouts,innings,source_url,updated_at`

---

## 5) Consolidation formula

In `PROJECTIONS_ALL!A2`, paste:

```gs
=ARRAYFORMULA(
  QUERY(
    {
      IF(RAW_NFL!A2:A="",,"nfl"),RAW_NFL!A2:Z;
      IF(RAW_NBA!A2:A="",,"nba"),RAW_NBA!A2:Z;
      IF(RAW_MLB!A2:A="",,"mlb"),RAW_MLB!A2:Z;
      IF(RAW_MMA!A2:A="",,"mma"),RAW_MMA!A2:Z;
      IF(RAW_GOLF!A2:A="",,"golf"),RAW_GOLF!A2:Z;
      IF(RAW_NASCAR!A2:A="",,"nascar"),RAW_NASCAR!A2:Z
    },
    "select * where Col2 is not null",
    0
  )
)
```

---

## 6) Derived metric formulas

Assuming consolidated data starts in row 2:

- `value` (H2):
```gs
=ARRAYFORMULA(IF(F2:F="",,F2:F/(E2:E/1000)))
```

- `floor` (I2):
```gs
=ARRAYFORMULA(IF(F2:F="",,F2:F*IFNA(VLOOKUP(A2:A,LOOKUPS!A:D,2,FALSE),0.65)))
```

- `ceiling` (J2):
```gs
=ARRAYFORMULA(IF(F2:F="",,F2:F*IFNA(VLOOKUP(A2:A,LOOKUPS!A:D,3,FALSE),1.4)))
```

- `boom_pct` (K2):
```gs
=ARRAYFORMULA(IF(F2:F="",,ROUND(100/(1+EXP(-(J2:J-F2:F)/6)),1)))
```

- `bust_pct` (L2):
```gs
=ARRAYFORMULA(IF(F2:F="",,ROUND(IFNA(VLOOKUP(A2:A,LOOKUPS!A:D,4,FALSE),35)+(100-K2:K)*0.25,1)))
```

- `volatility` (M2):
```gs
=ARRAYFORMULA(IF(F2:F="",,ROUND((J2:J-I2:I)/F2:F,3)))
```

- `game_script_fit` (N2):
```gs
=ARRAYFORMULA(IF(A2:A="",,IFS(
  A2:A="nfl","Role and correlation path",
  A2:A="nba","Minutes and usage stability",
  A2:A="mlb","Power/stack or K-upside path",
  A2:A="mma","Finish or decision volume path",
  A2:A="golf","Cut + birdie streak path",
  A2:A="nascar","Dominator vs place-diff path",
  TRUE,""
)))
```

---

## 7) Optional online import examples

Use these patterns per RAW tab if your source publishes a table/CSV URL:

- CSV:
```gs
=IMPORTDATA("https://example.com/projections.csv")
```

- HTML table:
```gs
=IMPORTHTML("https://example.com/page","table",1)
```

- JSON endpoint (Apps Script custom fetch) if needed.

Keep `source_url` populated for each row so provenance is visible.

---

## 8) Quality checks

Add conditional formatting checks in `PROJECTIONS_ALL`:

- Missing salary (`E` blank)
- Missing projection (`F` blank)
- Ownership outside `0-100`
- Negative floor/ceiling

---

## 9) Export for Upside Engine ingestion

When needed, export a sport-specific filtered view with columns:

`name,team,position,salary,projection,ceiling,floor,ownership,boom,bust,value,minutes`

This matches the CSV shape accepted by the private admin run payload.
