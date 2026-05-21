const columns = [
  "player_name",
  "team",
  "opponent",
  "position",
  "salary",
  "projection",
  "floor",
  "ceiling",
  "boom_pct",
  "bust_pct",
  "ownership",
  "ownership_source",
  "salary_value_score",
  "volatility_score",
  "upside_score",
  "leverage_score",
  "contest_fit_tag",
  "recommended_field_size",
  "single_entry_grade",
  "fake_chalk_warning",
  "fake_chalk_reason",
  "slate_breaker_tag",
  "showdown_captain_score",
  "showdown_flex_score",
  "captain_ownership_risk",
  "duplication_risk",
  "game_script_fit"
];

const routeLabels = {
  "top-upside": "Top Upside",
  leverage: "Leverage",
  "fake-chalk": "Fake Chalk",
  "single-entry": "Single Entry",
  "contest-fit": "Contest Fit",
  "showdown-captains": "Showdown Captains",
  "showdown-flex": "Showdown Flex"
};

const state = {
  activeRoute: "top-upside",
  rows: [],
  filteredRows: [],
  sortKey: "upside_score",
  sortDirection: "desc"
};

const els = {
  sport: document.getElementById("sportSelect"),
  slateType: document.getElementById("slateTypeSelect"),
  site: document.getElementById("siteSelect"),
  date: document.getElementById("dateInput"),
  contestType: document.getElementById("contestTypeSelect"),
  contestSize: document.getElementById("contestSizeInput"),
  search: document.getElementById("searchInput"),
  scan: document.getElementById("scanButton"),
  reload: document.getElementById("reloadButton"),
  status: document.getElementById("statusPill"),
  activeView: document.getElementById("activeView"),
  rowCount: document.getElementById("rowCount"),
  lastUpdated: document.getElementById("lastUpdated"),
  message: document.getElementById("messageBox"),
  head: document.getElementById("tableHead"),
  body: document.getElementById("tableBody"),
  tabs: Array.from(document.querySelectorAll(".tab"))
};

init();

function init() {
  els.date.value = new Date().toISOString().slice(0, 10);
  renderHeader();
  bindEvents();
  loadActiveRoute();
}

function bindEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeRoute = tab.dataset.route;
      state.sortKey = defaultSortForRoute(state.activeRoute);
      state.sortDirection = "desc";
      els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
      loadActiveRoute();
    });
  });

  [els.sport, els.slateType, els.site, els.contestType, els.contestSize].forEach((control) => {
    control.addEventListener("change", loadActiveRoute);
  });

  els.date.addEventListener("change", () => setMessage("Date changed. Use Scan / Refresh to pull provider data for that date, or Reload Table to view saved rows."));
  els.search.addEventListener("input", () => {
    applySearch();
    renderRows();
  });
  els.reload.addEventListener("click", loadActiveRoute);
  els.scan.addEventListener("click", runScan);
}

async function runScan() {
  setBusy(true, "Scanning");
  setMessage("Scan started. This can take a moment while provider data is processed.");

  try {
    const response = await requestJson(`/scan?${baseParams()}`, { method: "POST" });
    setMessage(`Scan complete. Slates: ${response.inserted_or_updated_slates || 0}. Players: ${response.inserted_or_updated_players || 0}.`);
    await loadActiveRoute();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false, "Ready");
  }
}

async function loadActiveRoute() {
  setBusy(true, "Loading");
  clearMessage();
  els.activeView.textContent = routeLabels[state.activeRoute] || state.activeRoute;

  try {
    const response = await requestJson(routeUrl(state.activeRoute));
    state.rows = normalizeRows(response);
    applySearch();
    renderRows();
    els.lastUpdated.textContent = new Date().toLocaleTimeString();
  } catch (error) {
    state.rows = [];
    state.filteredRows = [];
    renderRows();
    showError(error);
  } finally {
    setBusy(false, "Ready");
  }
}

function routeUrl(route) {
  const params = new URLSearchParams(baseParams());
  params.set("limit", "250");

  if (route === "contest-fit") {
    params.set("contest_type", els.contestType.value);
    params.set("contest_size", els.contestSize.value || "500");
  }

  return `/${route}?${params.toString()}`;
}

function baseParams() {
  const params = new URLSearchParams({
    sport: els.sport.value,
    slate_type: els.slateType.value,
    site: els.site.value
  });

  if (els.date.value) params.set("date", els.date.value);
  return params.toString();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    ...options
  });
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload
      ? payload.message || payload.provider_message || JSON.stringify(payload, null, 2)
      : text || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.players,
    payload.data,
    payload.results,
    payload.rows,
    payload.items,
    payload.slates
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function applySearch() {
  const query = els.search.value.trim().toLowerCase();
  const rows = query
    ? state.rows.filter((row) => columns.some((key) => String(row[key] ?? "").toLowerCase().includes(query)))
    : [...state.rows];

  state.filteredRows = rows.sort(compareRows);
  els.rowCount.textContent = String(state.filteredRows.length);
}

function compareRows(a, b) {
  const aValue = a[state.sortKey];
  const bValue = b[state.sortKey];
  const direction = state.sortDirection === "asc" ? 1 : -1;

  if (isNumeric(aValue) && isNumeric(bValue)) {
    return (Number(aValue) - Number(bValue)) * direction;
  }

  return String(aValue ?? "").localeCompare(String(bValue ?? "")) * direction;
}

function renderHeader() {
  const row = document.createElement("tr");
  row.append(...columns.map((key) => {
    const th = document.createElement("th");
    th.textContent = headerLabel(key);
    th.title = `Sort by ${headerLabel(key)}`;
    th.addEventListener("click", () => {
      if (state.sortKey === key) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDirection = "desc";
      }
      applySearch();
      renderRows();
    });
    return th;
  }));
  els.head.replaceChildren(row);
}

function renderRows() {
  if (!state.filteredRows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.textContent = state.rows.length ? "No players match the current search." : "No rows found. Run a scan or try a different tab.";
    td.className = "long";
    tr.append(td);
    els.body.replaceChildren(tr);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filteredRows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((key) => {
      const td = document.createElement("td");
      td.append(formatValue(key, row[key]));
      if (isLongColumn(key)) td.classList.add("long");
      tr.append(td);
    });
    fragment.append(tr);
  });
  els.body.replaceChildren(fragment);
}

function formatValue(key, value) {
  const span = document.createElement("span");

  if (typeof value === "boolean") {
    span.textContent = value ? "Yes" : "No";
    span.className = value ? "yes" : "no";
    return span;
  }

  if (value === null || value === undefined || value === "") {
    span.textContent = "-";
    span.className = "no";
    return span;
  }

  if (isNumeric(value) && key !== "player_id") {
    span.textContent = formatNumber(value, key);
    return span;
  }

  span.textContent = String(value);
  if (isLongColumn(key) || key.endsWith("_tag") || key.endsWith("_grade")) span.className = "tag";
  return span;
}

function formatNumber(value, key) {
  const number = Number(value);
  if (key === "salary") return `$${Math.round(number).toLocaleString()}`;
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function isNumeric(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value));
}

function isLongColumn(key) {
  return [
    "contest_fit_tag",
    "recommended_field_size",
    "single_entry_grade",
    "fake_chalk_reason",
    "captain_ownership_risk",
    "duplication_risk",
    "game_script_fit"
  ].includes(key);
}

function headerLabel(key) {
  return key.replaceAll("_", " ");
}

function defaultSortForRoute(route) {
  return {
    "top-upside": "upside_score",
    leverage: "leverage_score",
    "fake-chalk": "ownership",
    "single-entry": "upside_score",
    "contest-fit": "upside_score",
    "showdown-captains": "showdown_captain_score",
    "showdown-flex": "showdown_flex_score"
  }[route] || "upside_score";
}

function setBusy(isBusy, label) {
  [els.scan, els.reload, ...els.tabs].forEach((item) => {
    item.disabled = isBusy;
  });
  els.status.textContent = label;
  els.status.classList.toggle("loading", isBusy);
  els.status.classList.toggle("ok", !isBusy);
  els.status.classList.remove("error");
}

function setMessage(message) {
  els.message.textContent = message;
  els.message.classList.remove("hidden", "error");
}

function clearMessage() {
  els.message.textContent = "";
  els.message.classList.add("hidden");
  els.message.classList.remove("error");
}

function showError(error) {
  els.message.textContent = error.message || "Something went wrong.";
  els.message.classList.remove("hidden");
  els.message.classList.add("error");
  els.status.textContent = "Error";
  els.status.classList.remove("loading", "ok");
  els.status.classList.add("error");
}
