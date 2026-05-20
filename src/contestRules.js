export const SUPPORTED_SPORTS = ["nfl", "mlb", "nba", "mma", "golf", "nascar"];
export const SUPPORTED_SLATE_TYPES = ["classic", "showdown", "single_game"];
export const SUPPORTED_SITES = ["draftkings", "fanduel", "yahoo", "superdraft"];

export const CONTEST_TYPES = {
  cash: "Cash",
  single_entry: "Single Entry",
  small_field_gpp: "Small-Field GPP",
  mid_field_gpp: "Mid-Field GPP",
  large_field_gpp: "Large-Field GPP",
  mini_max: "Mini-MAX",
  winner_take_all: "Winner Take All"
};

export const FIELD_SIZE_BUCKETS = [
  { label: "50-500", min: 0, max: 500 },
  { label: "500-2,000", min: 501, max: 2000 },
  { label: "2,000-10,000", min: 2001, max: 10000 },
  { label: "10,000-50,000", min: 10001, max: 50000 },
  { label: "50k+", min: 50001, max: Number.POSITIVE_INFINITY }
];

export function normalizeSport(sport) {
  const normalized = String(sport || "").trim().toLowerCase();
  if (!SUPPORTED_SPORTS.includes(normalized)) {
    throw new Error(`Unsupported sport "${sport}". Supported sports: ${SUPPORTED_SPORTS.join(", ")}`);
  }
  return normalized;
}

export function normalizeSlateType(slateType = "classic") {
  const normalized = String(slateType || "classic").trim().toLowerCase();
  if (normalized === "single-game") return "showdown";
  if (!SUPPORTED_SLATE_TYPES.includes(normalized)) {
    throw new Error(`Unsupported slate_type "${slateType}". Supported slate types: ${SUPPORTED_SLATE_TYPES.join(", ")}`);
  }
  return normalized === "single_game" ? "showdown" : normalized;
}

export function normalizeSite(site = "draftkings") {
  return String(site || "draftkings").trim().toLowerCase();
}

export function getFieldSizeBucket(contestSize) {
  const size = Number(contestSize || 0);
  return FIELD_SIZE_BUCKETS.find((bucket) => size >= bucket.min && size <= bucket.max)?.label || "50k+";
}

export function inferContestType(contestType = "single_entry", contestSize = 500) {
  const normalized = String(contestType || "").trim().toLowerCase();
  if (CONTEST_TYPES[normalized]) return normalized;

  const size = Number(contestSize || 0);
  if (size <= 500) return "single_entry";
  if (size <= 2000) return "small_field_gpp";
  if (size <= 10000) return "mid_field_gpp";
  if (size <= 50000) return "large_field_gpp";
  return "mini_max";
}

export function contestFitMatches(player, contestType, contestSize) {
  const type = inferContestType(contestType, contestSize);
  const fieldBucket = getFieldSizeBucket(contestSize);
  const tag = String(player.contest_fit_tag || "").toLowerCase();
  const recommended = String(player.recommended_field_size || "");

  if (type === "cash") return player.floor >= 0.65 * player.projection && !player.fake_chalk_warning;
  if (type === "single_entry") return String(player.single_entry_grade || "").includes("Single Entry") && !String(player.single_entry_grade || "").includes("Not");
  if (type === "winner_take_all") return player.leverage_score >= 70 || tag.includes("large-field");
  if (type === "mini_max") return player.upside_score >= 60 && !tag.includes("cash");
  return recommended === fieldBucket || player.upside_score >= 65 || player.leverage_score >= 65;
}
