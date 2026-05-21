# DFS Upside Engine V1

Standalone multi-sport DFS engine for NFL, MLB, NBA, MMA/UFC, Golf, and NASCAR.

This is DFS-only. It does not use betting-pick logic, sportsbooks as recommendations, paid DFS scraping, or protected DFS content.

## Data Policy

Allowed sources:

- Tank01 API
- The Odds API
- Historical game logs from legal API/public JSON feeds
- Injury/news feeds from legal API/public JSON feeds
- DFS salary files or salary APIs you are legally allowed to use
- Request-body seed data supplied by your own backend/admin tools

Blocked sources:

- Paid DFS site scraping
- Protected Stokastic, RotoGrinders, SaberSim, FantasyLabs, or paid-tool content
- Single-vendor paid sports feed dependency

## Model Outputs

The engine generates:

- `projection`
- `floor`
- `ceiling`
- `boom_pct`
- `bust_pct`
- `estimated_ownership`
- `upside_score`
- `leverage_score`
- `fake_chalk_warning`
- `single_entry_grade`
- `contest_fit_tag`

It also preserves existing DFS logic for Top Upside, Leverage, Fake Chalk, Single Entry, Contest Fit, Showdown Captains, and Showdown Flex.

## Stack

- Node.js
- Express
- Supabase
- Railway
- Internal legal-data projection model

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example`:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3000
TANK01_RAPIDAPI_KEY=
TANK01_RAPIDAPI_HOST=
ODDS_API_KEY=
TANK01_PLAYERS_URL=
NFL_DRAFTKINGS_SALARIES_URL=
MLB_DRAFTKINGS_SALARIES_URL=
NBA_DRAFTKINGS_SALARIES_URL=
MMA_DRAFTKINGS_SALARIES_URL=
GOLF_DRAFTKINGS_SALARIES_URL=
NASCAR_DRAFTKINGS_SALARIES_URL=
NFL_INJURIES_URL=
MLB_INJURIES_URL=
NBA_INJURIES_URL=
MMA_INJURIES_URL=
GOLF_INJURIES_URL=
NASCAR_INJURIES_URL=
NFL_GAME_LOGS_URL=
MLB_GAME_LOGS_URL=
NBA_GAME_LOGS_URL=
MMA_GAME_LOGS_URL=
GOLF_GAME_LOGS_URL=
NASCAR_GAME_LOGS_URL=
```

Run `sql/schema.sql` in Supabase. Existing installs should re-run it so `dfs_players.estimated_ownership` is added.

Start locally:

```bash
npm run dev
```

Railway should run:

```bash
npm start
```

## Legal Feed Configuration

The backend can load player/salary seed rows from:

1. POST body `players` or `salaries`.
2. Sport/site salary feed URLs such as `NBA_DRAFTKINGS_SALARIES_URL`.
3. Generic sport salary URLs such as `NBA_SALARIES_URL`.
4. Tank01 URL templates.

URL templates may include query placeholders:

```env
NBA_DRAFTKINGS_SALARIES_URL=https://your-legal-feed.example/nba/dk-salaries.json?date={date}
NBA_INJURIES_URL=https://your-legal-feed.example/nba/injuries.json
NBA_GAME_LOGS_URL=https://your-legal-feed.example/nba/game-logs.json?date={date}
```

Tank01 can be configured with either one generic template or per-sport templates:

```env
TANK01_PLAYERS_URL=https://your-tank01-endpoint.example/players?sport={sport}&date={date}
NBA_TANK01_PLAYERS_URL=https://your-tank01-endpoint.example/nba/players?date={date}
```

If a feed is missing or fails, the route returns an empty array or empty scan result instead of crashing.

## Scan Example

You can seed a scan with your own legal player data:

```bash
POST /scan?sport=nba&slate_type=showdown&site=draftkings&date=2026-05-21
Content-Type: application/json

{
  "players": [
    {
      "PlayerID": "nba-1",
      "PlayerName": "Example Player",
      "Team": "DAL",
      "Opponent": "OKC",
      "Position": "PG",
      "Salary": 10400,
      "avgFantasyPoints": 48.2,
      "last5Average": 51.4,
      "roleBoost": 2
    }
  ]
}
```

The engine calculates projections, floor, ceiling, boom/bust rates, estimated ownership, upside, leverage, fake chalk, and contest tags from the legal seed data.

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

## Ownership Model

When real ownership is unavailable, the engine estimates ownership from:

- salary rank
- projection rank
- value rank
- recent performance
- injury/news role boost
- slate size
- position scarcity
- name popularity proxy

## Health

`GET /health` returns:

```json
{
  "nfl": "ok",
  "mlb": "ok",
  "nba": "ok",
  "mma": "ok",
  "golf": "ok",
  "nascar": "ok"
}
```

## Supported Sports

- NFL
- MLB
- NBA
- MMA/UFC
- Golf
- NASCAR
