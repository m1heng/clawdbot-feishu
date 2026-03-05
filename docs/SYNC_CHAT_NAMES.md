# Sync Feishu Chat Names

This script syncs Feishu chat names to the `bindings` configuration.

## Usage

```bash
# Dry run (preview changes without applying)
node ~/.openclaw/extensions/feishu/sync-feishu-names-standalone.js --dry-run

# Apply changes
node ~/.openclaw/extensions/feishu/sync-feishu-names-standalone.js
```

## What it does

1. Reads all Feishu group bindings from `~/.openclaw/openclaw.json`
2. Fetches chat names from Feishu API using `client.im.chat.list()`
3. Updates `peer.name` for each binding
4. Saves the updated config (with backup)

## Example

Before:
```json
{
  "bindings": [
    {
      "agentId": "project",
      "match": {
        "channel": "feishu",
        "peer": {
          "kind": "group",
          "id": "oc_f1c3487263639889eedb076c5afd4ad3"
        }
      }
    }
  ]
}
```

After:
```json
{
  "bindings": [
    {
      "agentId": "project",
      "match": {
        "channel": "feishu",
        "peer": {
          "kind": "group",
          "id": "oc_f1c3487263639889eedb076c5afd4ad3",
          "name": "Project Discussion Group"
        }
      }
    }
  ]
}
```

## When to run

- After adding new Feishu group bindings
- When chat names change
- Periodically to keep names up to date

## Requirements

- Feishu plugin installed and configured
- `@larksuiteoapi/node-sdk` package (installed with the plugin)
- Valid Feishu app credentials in config
