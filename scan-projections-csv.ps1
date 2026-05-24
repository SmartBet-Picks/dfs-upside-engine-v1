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

function Read-Number($Value, [double]$Fallback = 0) {
  if ($null -eq $Value) { return $Fallback }
  $clean = ([string]$Value).Replace("%", "").Replace("$", "").Replace(",", "").Trim()
  $number = 0.0
  if ([double]::TryParse($clean, [ref]$number)) { return $number }
  return $Fallback
}

function Is-Truthy($Value) {
  $text = ([string]$Value).Trim().ToLowerInvariant()
  return @("1", "true", "yes", "y", "starter", "starting", "confirmed") -contains $text
}

$csvRows = Import-Csv -LiteralPath $CsvPath
if (-not $csvRows -or $csvRows.Count -eq 0) {
  throw "CSV has no player rows: $CsvPath"
}

$players = $csvRows | ForEach-Object {
  $projection = Read-Number $_.Projection
  $stdDev = Read-Number $_."Std Dev" ($projection * 0.28)
  $ownership = Read-Number $_."Ownership %"
  $cptOwnership = Read-Number $_."CPT Ownership"
  $salary = [int](Read-Number $_.Salary)
  $mins = Read-Number $_.Mins
  $fppm = Read-Number $_.FPPM

  $floor = [Math]::Max(0, $projection - ($stdDev * 0.85))
  $ceiling = [Math]::Max($projection, $projection + ($stdDev * 1.35))
  $boomPct = [Math]::Max(4, [Math]::Min(55, 12 + (($ceiling / [Math]::Max($projection, 1)) - 1) * 38 + ($ownership - 15) * 0.08))
  $bustPct = [Math]::Max(5, [Math]::Min(70, 14 + (($stdDev / [Math]::Max($projection, 1)) * 55) - ($mins * 0.15)))

  @{
    PlayerID = "$($Sport)-$($_.Player)-$($_.Team)-$($_.Position)"
    PlayerName = $_.Player
    Team = $_.Team
    Opponent = $_.Opponent
    Position = $_.Position
    RosterPosition = $_.Position
    Salary = $salary
    Projection = [Math]::Round($projection, 2)
    Floor = [Math]::Round($floor, 2)
    Ceiling = [Math]::Round($ceiling, 2)
    BoomPercentage = [Math]::Round($boomPct, 2)
    BustPercentage = [Math]::Round($bustPct, 2)
    Ownership = [Math]::Round($ownership, 2)
    ProjectedOwnership = [Math]::Round($ownership, 2)
    CaptainOwnership = [Math]::Round($cptOwnership, 2)
    Value = Read-Number $_.Value
    Minutes = $mins
    FPPM = $fppm
    StdDev = $stdDev
    Injury = $_.Injury
    Starting = Is-Truthy $_.Starting
    source = "private_projection_csv"
  }
}

$body = @{
  players = $players
  source = "private_projection_csv"
  preserve_imported_projection = $true
  csv_file = [System.IO.Path]::GetFileName($CsvPath)
} | ConvertTo-Json -Depth 10

$uri = "$BaseUrl/scan?sport=$Sport&slate_type=$SlateType&site=$Site&date=$Date"
Write-Host "Scanning $($Sport.ToUpperInvariant()) $SlateType projections from $CsvPath"
Invoke-RestMethod -Uri $uri -Method POST -ContentType "application/json" -Body $body
