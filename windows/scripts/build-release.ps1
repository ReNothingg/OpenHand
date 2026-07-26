param(
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',
    [switch]$SkipWebBuild
)

$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$windowsDirectory = Split-Path -Parent $scriptDirectory
$projectDirectory = Split-Path -Parent $windowsDirectory
$buildDirectory = Join-Path $windowsDirectory 'build'
$publishDirectory = Join-Path $buildDirectory "OpenHand-$Runtime"
$archivePath = Join-Path $buildDirectory "OpenHand-$Runtime.zip"

Push-Location $projectDirectory
try {
    if (-not $SkipWebBuild) {
        & npm run build:web
        if ($LASTEXITCODE -ne 0) {
            throw "Web build failed with exit code $LASTEXITCODE."
        }
    }

    & dotnet publish (Join-Path $windowsDirectory 'OpenHand.csproj') `
        --configuration Release `
        --runtime $Runtime `
        --self-contained true `
        --output $publishDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Windows build failed with exit code $LASTEXITCODE."
    }

    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    Compress-Archive -Path (Join-Path $publishDirectory '*') `
        -DestinationPath $archivePath `
        -CompressionLevel Optimal

    $innoSetupCandidates = @(
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    )
    $innoSetup = $innoSetupCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if ($innoSetup) {
        & $innoSetup (Join-Path $windowsDirectory 'installer\OpenHand.iss')
        if ($LASTEXITCODE -ne 0) {
            throw "Installer build failed with exit code $LASTEXITCODE."
        }
    }
}
finally {
    Pop-Location
}

Write-Output "Ready: $publishDirectory"
Write-Output "Archive: $archivePath"
if (-not $innoSetup) {
    Write-Output "Inno Setup 6 was not found; portable ZIP was created without Setup.exe."
}
