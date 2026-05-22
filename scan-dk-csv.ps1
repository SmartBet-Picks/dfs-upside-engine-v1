param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("nfl", "mlb", "nba", "mma", "golf", "nascar")]
  [string]$Sport,

  [Parameter(Mandatory = $true)]
  [ValidateSet("classic", "showdown")]
  [string]$SlateType,

  [Parameter(Mandatory = $true)]
  [string]$CsvPath,

  [string]$Site = "draftkings",

  [string]$Date = (Get-Date -Format "yyyy-MM-dd"),

  [string]$BaseUrl = "https://dfs-upside-engine-v1-production.up.railway.app"
)

if (-not (Test-Path -LiteralPath $CsvPath)) {
  throw "CSV file not found: $CsvPath"
}

$allowedPositions = @{
  nba = @("PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "CPT", "FLEX")
  nfl = @("QB", "RB", "WR", "TE", "DST", "DEF", "FLEX", "CPT")
  mlb = @("P", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "UTIL", "CPT", "FLEX")
  mma = @("F", "FIGHTER", "CPT", "FLEX")
  golf = @("G", "GOLFER", "CPT", "FLEX")
  nascar = @("D", "DRIVER", "CPT", "FLEX")
}

function Split-PositionTokens([string]$Position) {
  if ([string]::IsNullOrWhiteSpace($Position)) {
    return @()
  }

  return $Position.ToUpperInvariant() -split "[/,\s]+" | Where-Object { $_ }
}

$csvRows = Import-Csv -LiteralPath $CsvPath
if (-not $csvRows -or $csvRows.Count -eq 0) {
  throw "CSV has no player rows: $CsvPath"
}

$badRows = @(
  $csvRows | Where-Object {
    $tokens = Split-PositionTokens $_.Position
    $tokens.Count -gt 0 -and -not ($tokens | Where-Object { $allowedPositions[$Sport] -contains $_ })
  } | Select-Object -First 8
)

if ($badRows.Count -gt 0) {
  $examples = ($badRows | ForEach-Object { "$($_.Name) ($($_.Position))" }) -join ", "
  throw "This CSV does not look like $($Sport.ToUpperInvariant()) data. Examples: $examples"
}

$players = $csvRows | ForEach-Object {
  $team = $_.TeamAbbrev
  $gameInfo = $_."Game Info"

  $teams = if ($gameInfo -match "^([A-Z]+)@([A-Z]+)") {
    @($Matches[1], $Matches[2])
  } else {
    @("", "")
  }

  $opponent = if ($teams[0] -eq $team) {
    $teams[1]
  } elseif ($teams[1] -eq $team) {
    $teams[0]
  } else {
    ""
  }

  $avg = 0
  [void][double]::TryParse($_."AvgPointsPerGame", [ref]$avg)

  $salary = 0
  [void][int]::TryParse($_.Salary, [ref]$salary)

  @{
    PlayerID = $_.ID
    PlayerName = $_.Name
    Team = $team
    Opponent = $opponent
    Position = $_.Position
    RosterPosition = $_."Roster Position"
    Salary = $salary
    avgFantasyPoints = $avg
  }
}

$body = @{
  players = $players
  source = "draftkings_csv"
  csv_file = [System.IO.Path]::GetFileName($CsvPath)
} | ConvertTo-Json -Depth 10

$uri = "$BaseUrl/scan?sport=$Sport&slate_type=$SlateType&site=$Site&date=$Date"
Write-Host "Scanning $($Sport.ToUpperInvariant()) $SlateType from $CsvPath"
Invoke-RestMethod -Uri $uri -Method POST -ContentType "application/json" -Body $body
