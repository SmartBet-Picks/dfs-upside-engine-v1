import test from "node:test";
import assert from "node:assert/strict";
import { buildEntryPortfolio, lineupsToCsv, optimizeLineups } from "../src/optimizerEngine.js";

function player(name, slot = "UTIL", overrides = {}) {
  return {
    slot,
    player_id: name.toLowerCase().replaceAll(" ", "-"),
    player_name: name,
    team: overrides.team || "TST",
    position: overrides.position || slot,
    salary: overrides.salary || 6000,
    projection: overrides.projection || 30,
    floor: overrides.floor || 18,
    ceiling: overrides.ceiling || 48,
    ownership: overrides.ownership || 18,
    upside_score: overrides.upside_score || 70,
    leverage_score: overrides.leverage_score || 65,
    boom_pct: overrides.boom_pct || 25,
    bust_pct: overrides.bust_pct || 15,
    fake_chalk_warning: false,
    single_entry_grade: "Strong Play",
    contest_fit_tag: "Large-field GPP",
    strategy_score: overrides.strategy_score || 70
  };
}

function lineup(id, names, overrides = {}) {
  const players = names.map((name, index) => player(name, index === 0 && overrides.showdown ? "CPT" : `UTIL${index + 1}`, { ownership: 12 + index }));
  return {
    lineup_id: id,
    salary: 48000,
    projection: overrides.projection || 220,
    floor: 145,
    ceiling: overrides.ceiling || 330,
    ownership: players.reduce((total, p) => total + p.ownership, 0),
    upside: 72,
    leverage: 68,
    volatility: 185,
    strategy_score: 74,
    fake_chalk_count: 0,
    single_entry_count: 4,
    objective_score: overrides.objective_score || 100,
    archetype: overrides.archetype || "Balanced Build",
    players
  };
}

test("buildEntryPortfolio applies exposure caps before ranking-only selection", () => {
  const lineups = [
    lineup("l1", ["Alpha", "Bravo", "Charlie", "Delta"], { objective_score: 110 }),
    lineup("l2", ["Alpha", "Echo", "Foxtrot", "Golf"], { objective_score: 109 }),
    lineup("l3", ["Alpha", "Hotel", "India", "Juliet"], { objective_score: 108 }),
    lineup("l4", ["Kilo", "Lima", "Mike", "November"], { objective_score: 107 }),
    lineup("l5", ["Oscar", "Papa", "Quebec", "Romeo"], { objective_score: 106 })
  ];

  const portfolio = buildEntryPortfolio(lineups, {
    entries_played: 4,
    field_size: 25000,
    max_player_exposure_pct: 50,
    portfolio_min_unique_players: 1
  });

  assert.equal(portfolio.recommended.length, 4);
  assert.equal(portfolio.portfolio_constraints.max_player_appearances, 2);
  assert.ok(portfolio.exposure_report.players.find((p) => p.player_name === "Alpha").lineups <= 2);
  assert.equal(portfolio.exposure_report.max_player_exposure_pct, 50);
});

test("optimizeLineups returns legal NBA lineups with analytics", () => {
  const players = [
    ["PG A", "PG", 9200, 48], ["PG B", "PG", 7100, 36], ["SG A", "SG", 8600, 43], ["SG B", "SG", 6200, 31],
    ["SF A", "SF", 8000, 39], ["SF B", "SF", 5700, 29], ["PF A", "PF", 7800, 38], ["PF B", "PF", 5400, 28],
    ["C A", "C", 8500, 42], ["C B", "C", 5000, 27], ["G A", "PG/SG", 6900, 35], ["F A", "SF/PF", 6600, 34],
    ["UTIL A", "SG/SF", 4800, 25], ["UTIL B", "PF/C", 4500, 24]
  ].map(([name, position, salary, projection], index) => ({
    player_id: `p${index}`,
    player_name: name,
    team: index % 2 ? "AWY" : "HME",
    position,
    salary,
    projection,
    floor: projection * 0.65,
    ceiling: projection * 1.55,
    ownership: 8 + index,
    projected_minutes: 28,
    upside_score: 62 + index,
    leverage_score: 58 + index,
    boom_pct: 18 + index,
    bust_pct: Math.max(5, 18 - index),
    single_entry_grade: index < 8 ? "Strong Play" : "Viable",
    contest_fit_tag: index % 3 === 0 ? "Leverage" : "Balanced"
  }));

  const lineups = optimizeLineups(players, {
    sport: "nba",
    slate_type: "classic",
    lineup_count: 3,
    salary_cap: 50000,
    min_unique_players: 1,
    min_projection: 1,
    simulations: 20
  });

  assert.ok(lineups.length > 0);
  for (const built of lineups) {
    assert.equal(built.players.length, 8);
    assert.ok(built.salary <= 50000);
    assert.ok(built.salary_left >= 0);
    assert.ok(["Low", "Medium", "High"].includes(built.duplication_risk));
    assert.ok(built.simulation.top_rate >= 0);
  }
});

test("lineupsToCsv includes portfolio-quality analytics columns", () => {
  const csv = lineupsToCsv([lineup("l1", ["Alpha", "Bravo", "Charlie", "Delta"])]);
  assert.match(csv.split("\n")[0], /duplication_risk/);
  assert.match(csv.split("\n")[0], /correlation_rating/);
  assert.match(csv, /Alpha/);
});

test("showdown optimizer preserves Strong, Viable, and Thin Captain labels on lineup players", () => {
  const tiers = [
    ["Strong Cap", 64],
    ["Viable Cap", 52],
    ["Thin Cap", 40],
    ["Flex A", 30],
    ["Flex B", 28],
    ["Flex C", 26],
    ["Flex D", 24],
    ["Flex E", 22],
    ["Flex F", 20]
  ];
  const players = tiers.map(([name, captainScore], index) => ({
    player_id: `sd${index}`,
    player_name: name,
    team: index < 5 ? "HME" : "AWY",
    position: "FLEX",
    salary: index === 0 ? 11000 : 5200 + index * 100,
    projection: 22 - index,
    floor: 12,
    ceiling: 42 - index,
    ownership: 10 + index,
    projected_minutes: 30,
    upside_score: 65 - index,
    leverage_score: 60 - index,
    boom_pct: 22,
    bust_pct: 12,
    showdown_captain_score: captainScore,
    showdown_flex_score: 62 - index,
    captain_tier: captainScore >= 58 ? "Strong Captain" : captainScore >= 48 ? "Viable Captain" : "Thin Captain"
  }));

  const lineups = optimizeLineups(players, {
    sport: "nfl",
    slate_type: "showdown",
    lineup_count: 10,
    salary_cap: 50000,
    min_projection: 1,
    min_unique_players: 0,
    simulations: 0
  });

  const labels = new Set(lineups.flatMap((built) => built.players.map((p) => p.captain_tier)));
  assert.ok(labels.has("Strong Captain"));
  assert.ok(labels.has("Viable Captain"));
  assert.ok(labels.has("Thin Captain"));
});
