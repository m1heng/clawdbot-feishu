# Probe Cache Verification Guide

## Overview
This document describes how to verify that the probe result caching is working correctly.

## Testing Steps

### 1. Enable Debug Logging (Optional)
Add temporary console.log statements to see cache hits:

```typescript
// In src/probe.ts, after getCachedProbeResult check:
const cached = getCachedProbeResult(creds.appId);
if (cached) {
  console.log(`[probe-cache] Cache HIT for appId=${creds.appId}`);
  return cached;
}
console.log(`[probe-cache] Cache MISS for appId=${creds.appId}, calling API...`);
```

### 2. Monitor API Calls
Watch for actual Feishu API calls in the logs. With caching:
- First call within 5 minutes → API call (cache miss)
- Subsequent calls within 5 minutes → no API call (cache hit)

### 3. Expected Behavior

**Without Cache (Before):**
```
00:00 → API call
01:00 → API call
02:00 → API call
03:00 → API call
...
```

**With Cache (After):**
```
00:00 → API call (cache miss)
01:00 → cache hit
02:00 → cache hit
03:00 → cache hit
04:00 → cache hit
05:00 → API call (cache expired)
06:00 → cache hit
...
```

### 4. Failure Recovery Test
1. Stop Feishu service or invalidate credentials
2. Wait for probe to fail (should cache for 1 minute)
3. Restore service
4. Next probe after 1 minute should detect recovery

### 5. Manual Cache Clear
Test the exported `clearProbeCache()` function:

```typescript
import { clearProbeCache, probeFeishu } from '@m1heng-clawd/feishu';

// Clear cache for specific appId
clearProbeCache('cli_xxxxx');

// Or clear all caches
clearProbeCache();
```

## Metrics

### API Call Reduction
- **Before:** ~60 calls/hour = ~1,440 calls/day
- **After:** ~12 calls/hour = ~288 calls/day
- **Reduction:** 80% fewer API calls

### Cache Hit Rate (Expected)
- **Success case:** ~83% hit rate (5 min cache / 6 probes per 5 min)
- **Failure case:** ~0% hit rate (1 min cache ensures fast recovery detection)

## Implementation Details

### Cache Keys
- Format: `probe:{appId}`
- Example: `probe:cli_a12345678901000a`
- Default: `probe:default` (when appId unavailable)

### Cache Duration
```typescript
const SUCCESS_CACHE_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_CACHE_MS = 1 * 60 * 1000; // 1 minute
```

### Cache Storage
- In-memory Map (process-scoped)
- Cleared on process restart
- Per-appId isolation (supports multiple Feishu apps)
