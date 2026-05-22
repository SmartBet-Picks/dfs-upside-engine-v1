create extension if not exists "pgcrypto";

create table if not exists dfs_slates (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  slate_type text not null,
  provider text not null default 'internal_model',
  site text not null,
  slate_id text not null,
  slate_name text,
  slate_start_time timestamptz,
  salary_cap numeric,
  roster_slots jsonb,
  game_count int,
  created_at timestamptz not null default now()
);

create unique index if not exists dfs_slates_unique_provider_slate
on dfs_slates (provider, site, sport, slate_type, slate_id);

create table if not exists dfs_players (
  id uuid primary key default gen_random_uuid(),
  slate_id uuid not null references dfs_slates(id) on delete cascade,
  sport text not null,
  slate_type text not null,
  site text not null,
  player_id text not null,
  player_name text,
  team text,
  opponent text,
  position text,
  roster_slot text,
  salary numeric,
  projection numeric,
  floor numeric,
  ceiling numeric,
  boom_pct numeric,
  bust_pct numeric,
  ownership numeric,
  estimated_ownership numeric,
  ownership_source text,
  volatility_score numeric,
  salary_value_score numeric,
  upside_score numeric,
  leverage_score numeric,
  contest_fit_tag text,
  recommended_field_size text,
  single_entry_grade text,
  small_field_grade text,
  large_field_grade text,
  fake_chalk_warning boolean default false,
  fake_chalk_reason text,
  slate_breaker_tag boolean default false,
  showdown_captain_score numeric,
  showdown_flex_score numeric,
  captain_ownership_risk text,
  duplication_risk text,
  game_script_fit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dfs_players
add column if not exists estimated_ownership numeric;

create unique index if not exists dfs_players_unique_slate_player_slot
on dfs_players (slate_id, site, player_id, roster_slot);

create index if not exists dfs_players_sport_slate_type_idx
on dfs_players (sport, slate_type, site);

create index if not exists dfs_players_sport_upside_idx
on dfs_players (sport, slate_type, site, upside_score desc);

create index if not exists dfs_players_sport_leverage_idx
on dfs_players (sport, slate_type, site, leverage_score desc);

create index if not exists dfs_players_sport_ownership_idx
on dfs_players (sport, slate_type, site, ownership desc);

create index if not exists dfs_players_sport_captain_idx
on dfs_players (sport, slate_type, site, showdown_captain_score desc);

create index if not exists dfs_players_sport_flex_idx
on dfs_players (sport, slate_type, site, showdown_flex_score desc);

create index if not exists dfs_players_upside_idx
on dfs_players (upside_score desc);

create index if not exists dfs_players_leverage_idx
on dfs_players (leverage_score desc);

create index if not exists dfs_players_single_entry_idx
on dfs_players (single_entry_grade);

create table if not exists dfs_scan_logs (
  id uuid primary key default gen_random_uuid(),
  sport text,
  slate_type text,
  status text,
  message text,
  players_processed int default 0,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists dfs_players_set_updated_at on dfs_players;
create trigger dfs_players_set_updated_at
before update on dfs_players
for each row execute function set_updated_at();
