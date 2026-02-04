# Changelog

## [Unreleased]

### Added
- Probe result caching to reduce Feishu API calls
  - Success results cached for 10 minutes
  - Failure results cached for 1 minute (for faster recovery detection)
  - Exported `clearProbeCache()` function for manual cache clearing

### Changed
- `probeFeishu()` now checks cache before making API calls
- Significantly reduced API quota consumption (from ~1440 calls/day to ~144 calls/day)

### Technical Details
The OpenClaw framework calls `status.probeAccount` every 60 seconds to check channel health.
Without caching, this results in excessive Feishu API calls:
- Before: 60 calls/hour = 1440 calls/day
- After: 6 calls/hour = 144 calls/day (with 10-minute cache)

Cache behavior:
- Successful probes: cached for 10 minutes
- Failed probes: cached for 1 minute (to detect recovery faster)
- Cache is per-appId (supports multiple Feishu apps)
