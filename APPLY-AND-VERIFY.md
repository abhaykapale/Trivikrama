# INT-01B Collector-to-backend handoff alignment

This patch aligns the cumulative COL-01H Collector with the backend's frozen
filesystem intake contract.

## Resulting shared layout

```text
collector/runtime/handoff/
├── incoming/
│   └── <collector-id>/
│       ├── batch_<uuid-v4>.json
│       └── heartbeat.json
├── processing/
├── processed/
└── quarantine/
```

The Collector publishes only into the identity-scoped `incoming` directory.
The backend atomically claims batches into `processing` and later moves them to
`processed` or `quarantine`.

## Apply on Windows

Extract this archive into `D:\Trivikrama` and allow the six existing files to
be replaced. The archive deliberately does not contain or replace `.env`.

Update the backend's environment-specific handoff root:

```powershell
cd D:\Trivikrama\backend

$envPath = ".\.env"
$contents = Get-Content $envPath
$replacement = "COLLECTOR_DIR=../collector/runtime/handoff"

if ($contents -match '^COLLECTOR_DIR=') {
    $contents = $contents -replace '^COLLECTOR_DIR=.*$', $replacement
} else {
    $contents += $replacement
}

Set-Content -Path $envPath -Value $contents -Encoding utf8
```

## Rebuild and verify the Collector

Use the Visual Studio Developer PowerShell where `cl` is available:

```powershell
cd D:\Trivikrama\collector
cmake --build --preset dev
ctest --preset dev
```

The existing HMAC secret remains unchanged. Validate configuration using the
same `COLLECTOR_HMAC_SECRET` value already configured for the backend:

```powershell
.\out\build\dev\collector.exe --check-config .\config\collector.yaml
```

After a fresh Collector run, the expected paths are:

```powershell
Get-ChildItem `
    .\runtime\handoff\incoming\collector-dev-01 `
    -File |
    Select-Object Name, Length, LastWriteTime
```

Expected filenames include `batch_<uuid-v4>.json` and `heartbeat.json`.

