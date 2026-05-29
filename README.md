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
  "date": "2026-05-26",
  "sport": "nba",
  "platform": "draftkings",
  "slateType": "classic",
  "contestType": "Single Entry",
  "showRawAdminData": false
}
```


## Classic vs. Showdown slates
- Set `slateType` to `classic` for standard six-fighter MMA builds; the admin engine returns classic tiers, classic scores, and six-slot `F1`-`F6` lineups.
- Set `slateType` to `showdown` for CPT/FLEX multiplier builds; the engine returns captain/flex scores and showdown lineups.
- DraftKings MMA classic CSVs with `Name + ID`, `Position`/`Roster Position`, `Salary`, and `AvgPointsPerGame` are accepted.

## Privacy Model
- Raw CSV input stays server-side in private scoring flow.
- Public API excludes raw projection, ceiling, floor, ownership, boom, and bust source numbers.
- Admin result can include raw fields only when `showRawAdminData=true`.

## Database changes
- None required for this in-memory implementation.
- If persistent history is desired, add admin/private and public snapshot tables and only expose public table.
