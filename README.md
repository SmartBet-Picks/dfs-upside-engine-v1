# DFS Upside Engine V1

Standalone multi-sport DFS engine for NFL, MLB, NBA, MMA, Golf, and NASCAR.

This is DFS-only. It does not connect to SmartBet and does not use betting-pick, moneyline, or sportsbook logic.

## Features

- Classic slates
- Showdown / single-game slates
- Single Entry contests
- Small-field GPP
- Mid-field GPP
- Large-field GPP
- Mini-MAX
- Winner Take All
- JSON API first
- Dashboard-ready later
- SportsDataIO primary provider
- Supabase persistence
- Railway-ready Express server

## Stack

- Node.js
- Express
- Supabase
- Railway
- SportsDataIO API

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`:

```bash
SPORTSDATAIO_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3000
```

3. Create the Supabase tables:

Open Supabase SQL Editor and run:

```sql
-- paste sql/schema.sql here
```

4. Start locally:

```bash
npm run dev
```

5. Deploy to Railway:

- Create a new Railway project.
- Connect this GitHub repo.
- Add the same environment variables.
- Railway should run `npm start`.

## SportsDataIO Endpoints

SportsDataIO endpoint paths can differ by sport, product tier, and subscription access. All endpoint paths are intentionally centralized in:

```text
src/sportsdataioClient.js
```

Edit `SPORTSDATAIO_ENDPOINTS` if your SportsDataIO plan uses different paths.

For MLB Classic, the engine uses these SportsDataIO fantasy/projections feeds:

```text
/v3/mlb/projections/json/DfsSlatesByDate/{date}
/v3/mlb/projections/json/PlayerGameProjectionStatsByDate/{date}
```

MLB DFS salaries/player rows are read from `DfsSlatePlayers` embedded in the `DfsSlatesByDate` response. If a slate does not include embedded players, the engine falls back to `PlayerGameProjectionStatsByDate`.

Some non-team sports need extra query values:

- MMA may need `eventId`
- Golf may need `tournamentId`
- NASCAR may need `raceId`

Example:

```bash
POST /scan?sport=golf&slate_type=classic&site=draftkings&tournamentId=123
POST /scan?sport=nascar&slate_type=classic&site=draftkings&raceId=123
POST /scan?sport=mma&slate_type=classic&site=draftkings&eventId=123
```

## Routes

```text
GET /
GET /health
GET /sports
GET /slates?sport=mlb&slate_type=classic
POST /scan?sport=mlb&slate_type=classic&site=draftkings
GET /players?sport=mlb&slate_type=classic
GET /top-upside?sport=mlb&slate_type=classic
GET /leverage?sport=mlb&slate_type=classic
GET /fake-chalk?sport=mlb&slate_type=classic
GET /single-entry?sport=mlb&slate_type=classic
GET /contest-fit?sport=mlb&slate_type=classic&contest_type=single_entry&contest_size=500
GET /showdown-captains?sport=nfl&slate_type=showdown
GET /showdown-flex?sport=nfl&slate_type=showdown
DELETE /clear-slate?sport=mlb&slate_type=classic
```

Add `&site=fanduel` or another site when needed. Default site is `draftkings`.

## Scan Flow

`POST /scan` does this:

1. Fetches SportsDataIO slates.
2. Upserts each slate into `dfs_slates`.
3. Fetches slate players.
4. Fetches projections when available.
5. Fetches ownership when available.
6. Estimates ownership when provider ownership is missing.
7. Calculates DFS upside, leverage, salary value, volatility, contest fit, field-size fit, fake chalk, and Single Entry grades.
8. Calculates showdown captain/flex scores when `slate_type=showdown`.
9. Upserts players into `dfs_players`.
10. Writes a row to `dfs_scan_logs`.

Every scan logs progress to the console and returns inserted/updated counts in JSON.

## Testing Scan

Start with health and route checks:

```bash
GET /health
GET /sports
GET /slates?sport=mlb&slate_type=classic&site=draftkings&date=2026-05-20
```

Then run an MLB Classic scan:

```bash
POST /scan?sport=mlb&slate_type=classic&site=draftkings&date=2026-05-20
```

Expected success response:

```json
{
  "sport": "mlb",
  "slate_type": "classic",
  "site": "draftkings",
  "status": "success",
  "inserted_or_updated_slates": 1,
  "inserted_or_updated_players": 100
}
```

Provider endpoint failures return clean JSON with the failing endpoint and requested URL without the API key:

```json
{
  "error": true,
  "type": "provider_endpoint_failed",
  "provider": "sportsdataio",
  "sport": "mlb",
  "endpoint": "projections",
  "requested_path": "/v3/mlb/projections/json/PlayerGameProjectionStatsByDate/2026-05-20",
  "requested_url_without_key": "https://api.sportsdata.io/v3/mlb/projections/json/PlayerGameProjectionStatsByDate/2026-05-20"
}
```

Railway logs will also show sanitized provider request paths:

```text
[sportsdataio] GET mlb.slates /v3/mlb/projections/json/DfsSlatesByDate/2026-05-20
[sportsdataio] mlb.players using embedded DfsSlatePlayers from DfsSlatesByDate
[sportsdataio] GET mlb.projections /v3/mlb/projections/json/PlayerGameProjectionStatsByDate/2026-05-20
```

## Universal Player Model

Every sport normalizes into:

```text
player_name
sport
slate_type
site
team
opponent
position
salary
projection
floor
ceiling
boom_pct
bust_pct
ownership
ownership_source
```

## Scoring Outputs

The engine calculates:

```text
salary_value_score
volatility_score
upside_score
leverage_score
contest_fit_tag
recommended_field_size
single_entry_grade
small_field_grade
large_field_grade
fake_chalk_warning
fake_chalk_reason
slate_breaker_tag
```

Showdown mode also calculates:

```text
showdown_captain_score
showdown_flex_score
captain_ownership_risk
duplication_risk
game_script_fit
```

## Contest Types

Supported contest logic:

- Cash
- Single Entry
- Small-Field GPP
- Mid-Field GPP
- Large-Field GPP
- Mini-MAX
- Winner Take All

Single Entry tags:

- Single Entry Core
- Single Entry Strong Play
- Single Entry Leverage
- Single Entry Risky
- Not For Single Entry

Recommended field sizes:

- 50-500
- 500-2,000
- 2,000-10,000
- 10,000-50,000
- 50k+

Showdown tags:

- Captain Core
- Captain Leverage
- Flex Core
- Flex Value
- Too Chalky Captain
- Large-Field Captain Dart
- Small-Field Flex Safe
- Single Entry Captain
- Single Entry Flex

## Important Notes

- Do not hardcode API keys.
- Keep SportsDataIO endpoint changes inside `src/sportsdataioClient.js`.
- This project is completely separate from SmartBet.
- This project is DFS-only.
- The dashboard can be added later on top of these JSON routes.
