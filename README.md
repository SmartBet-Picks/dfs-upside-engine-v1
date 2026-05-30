# DFS Upside Engine (Private CSV -> Public Transformed Output)

## Setup
1. Install deps: `npm install`
2. Configure `.env`:
   - `PORT=3000`
   - `ADMIN_API_TOKEN=your-private-admin-token`
   - Existing Supabase vars if you still use legacy scan routes:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_KEY`
3. Start: `npm run dev` or `npm start`

## Routes / Pages
- `GET /dashboard` - Admin + public dashboard UI.
- `POST /admin/upside-engine/run` - Private admin run endpoint (requires `x-admin-token`).
- `GET /api/upside/public` - Public transformed results only (no raw projection fields).

## Request payload for `/admin/upside-engine/run`
```json
{
  "csv": "name,team,position,salary,projection,ceiling,floor,ownership,boom,bust,value,minutes\n...",
  "entryCsv": "Entry ID,Contest Name,PG,SG,SF,PF,C,G,F,UTIL\n...",
  "entryFileName": "draftkings-entries.csv",
  "date": "2026-05-26",
  "sport": "nba",
  "platform": "draftkings",
  "slateType": "classic",
  "contestType": "Single Entry",
  "maxEntries": 150,
  "lineupsPlaying": 12,
  "pctPaidToFirst": 22.5,
  "contestProfile": {
    "contestName": "DK NBA $15 Large Field GPP",
    "contestId": "optional-contest-id",
    "entryFee": 15,
    "fieldSize": 20000,
    "maxEntries": 150,
    "yourEntries": 20,
    "prizePool": 300000,
    "firstPlacePrize": 75000,
    "paidSpots": 4000,
    "percentFieldPaid": 20,
    "contestType": "Large Field GPP",
    "lateSwapEnabled": true,
    "slateName": "Main Slate",
    "duplicationRiskTarget": "High"
  },
  "showRawAdminData": false
}
```



## Exact contest profile
- The admin dashboard includes a **Contest Profile / Exact Contest Settings** panel for manual DraftKings/FanDuel contest details.
- Exact contest fields tune the new `exactContestScore`, contest-aware recommendations, numeric `bustRiskScore`, and lineup archetypes.
- The public player output keeps the readable `bustRisk` label and also exposes `bustRiskLabel` plus numeric `bustRiskScore` for sorting/scoring.
- Response metadata now includes `contestProfile` and a `recommendations` object with exact-contest, raw projection, ceiling, leverage, single-entry, cash, large-field GPP, captain/flex, and fade signals.

## Classic vs. Showdown slates
- Set `slateType` to `classic` for standard six-fighter MMA builds; the admin engine returns classic tiers, classic scores, and six-slot `F1`-`F6` lineups.
- Set `slateType` to `showdown` for CPT/FLEX multiplier builds; the engine returns captain/flex scores and showdown lineups.
- DraftKings MMA classic CSVs with `Name + ID`, `Position`/`Roster Position`, `Salary`, and `AvgPointsPerGame` are accepted.

## Privacy Model
- Raw projection CSV and optional contest entry CSV input stay server-side in the private scoring flow.
- Public API excludes raw projection, ceiling, floor, ownership, boom, and bust source numbers.
- Admin result can include raw fields only when `showRawAdminData=true`.

## Database changes
- None required for this in-memory implementation.
- If persistent history is desired, add admin/private and public snapshot tables and only expose public table.
