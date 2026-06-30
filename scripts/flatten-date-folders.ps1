# Moves company folders from {saveRoot}/{YYYY-MM-DD}/{company}/ to {saveRoot}/{company}/.

param(
  [Parameter(Mandatory = $true)]
  [string]$SaveRoot
)

$ErrorActionPreference = 'Stop'
$DateFolderRe = '^\d{4}-\d{2}-\d{2}$'

if (-not (Test-Path -LiteralPath $SaveRoot)) {
  throw "Save root not found: $SaveRoot"
}

$moved = 0
$skipped = 0
$errors = @()

$dateDirs = Get-ChildItem -LiteralPath $SaveRoot -Directory |
  Where-Object { $_.Name -match $DateFolderRe } |
  Sort-Object Name

foreach ($dayDir in $dateDirs) {
  $companies = Get-ChildItem -LiteralPath $dayDir.FullName -Directory -ErrorAction SilentlyContinue
  foreach ($companyDir in $companies) {
    $destPath = Join-Path $SaveRoot $companyDir.Name
    try {
      if (Test-Path -LiteralPath $destPath) {
        $skipped++
        $errors += "SKIP (exists): $($companyDir.Name) from $($dayDir.Name)"
        continue
      }
      Move-Item -LiteralPath $companyDir.FullName -Destination $destPath
      $moved++
    } catch {
      $errors += "ERROR $($companyDir.Name): $($_.Exception.Message)"
    }
  }

  try {
    $left = Get-ChildItem -LiteralPath $dayDir.FullName -Force -ErrorAction SilentlyContinue
    if (-not $left -or $left.Count -eq 0) {
      Remove-Item -LiteralPath $dayDir.FullName -Force
    }
  } catch {
    $errors += "ERROR removing date folder $($dayDir.Name): $($_.Exception.Message)"
  }
}

Write-Output "Done. Moved: $moved, Skipped: $skipped, Errors: $($errors.Count)"
if ($errors.Count -gt 0) {
  $errors | Select-Object -First 40 | ForEach-Object { Write-Output $_ }
}
