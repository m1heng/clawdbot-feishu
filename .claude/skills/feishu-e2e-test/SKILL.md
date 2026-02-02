---
name: feishu-e2e-test
description: Local E2E debug and test framework for clawd-feishu plugin development. Use when debugging message flow, testing bot responses, verifying Feishu web UI interactions, or performing end-to-end validation of the OpenClaw-Feishu integration during development.
allowed-tools: Bash(agent-browser:*)
---

# Feishu E2E Test Framework

Local development testing using `agent-browser` CLI to interact with Feishu web app.

## Prerequisites

- Feishu web logged in at `https://feishu.cn/next/messenger`
- `agent-browser` CLI available
- OpenClaw locally installed
- Feishu bot appid/secret given in chat or in .env
- User given bot name which will display in Feishu web UI

## Important Notes

**Every time you modify extension code, you MUST restart OpenClaw Gateway for changes to take effect.**

```bash
# Restart gateway (required after code changes)
openclaw gateway restart

# Check if gateway is running
ps aux | grep openclaw

# View gateway logs
tail -f ~/.openclaw/logs/gateway.log
```

## agent-browser Usage

Always use `--headed` mode so user can see the browser and help with login:

```bash
agent-browser --headed --session feishu-test open "https://feishu.cn/next/messenger"
```

## Feishu Web UI Tips

Feishu web has complex UI that makes direct clicking unreliable. Use these strategies:

### 1. Use Search (Cmd+K) Instead of Clicking

Clicking on chat list items often misses or selects wrong item. Use global search:

```bash
# Open search
agent-browser --session feishu-test press "Meta+k"

# Type bot name letter by letter
agent-browser --session feishu-test press "o"
agent-browser --session feishu-test press "p"
agent-browser --session feishu-test press "e"
agent-browser --session feishu-test press "n"

# Select first result
agent-browser --session feishu-test press "Enter"
```

### 2. Focus Input with "/" Key

After entering a chat, press "/" to focus the message input:

```bash
agent-browser --session feishu-test press "/"
agent-browser --session feishu-test press "Backspace"  # Remove the "/"
# Then type your message
```

### 3. Type Characters One by One

The `type` command often fails with special characters. Use `press` for each character:

```bash
# Instead of: agent-browser type "ping"
agent-browser --session feishu-test press "p"
agent-browser --session feishu-test press "i"
agent-browser --session feishu-test press "n"
agent-browser --session feishu-test press "g"
```

### 4. Chinese Characters Do NOT Work

**Chinese characters cannot be typed with `press` command.** Use English only:

```bash
# BAD - Chinese won't render
for char in $(echo "读取文档" | grep -o .); do
  agent-browser --session feishu-test press "$char"  # Will fail silently
done

# GOOD - Use English
for char in r e a d " " d o c; do
  agent-browser --session feishu-test press "$char"
done
```

### 5. Typing Spaces

Spaces must be quoted as `" "`:

```bash
# Type "read doc"
for char in r e a d " " d o c; do
  agent-browser --session feishu-test press "$char"
done
```

### 6. Typing Long Strings Efficiently

Use a for loop to type URLs or long text:

```bash
# Type a full URL
url="https://feishu.cn/docx/YOUR_DOC_TOKEN"
for char in $(echo "$url" | grep -o .); do
  agent-browser --session feishu-test press "$char" 2>/dev/null || true
done
```

### 7. Avoid JS eval on Feishu

Do NOT use `eval` to set input values - it can break the page:

```bash
# BAD - will corrupt page
agent-browser eval "document.activeElement.innerText = 'text'"

# GOOD - use keyboard input
agent-browser press "t" && agent-browser press "e" ...
```

### 8. Full URLs Work Better Than IDs

When testing document tools, send full URLs rather than just document IDs:

```bash
# Better - bot recognizes as document link
"https://feishu.cn/docx/YOUR_DOC_TOKEN"

# Less reliable - may not trigger tool
"read YOUR_DOC_TOKEN"
```

## Verifying Tool Calls

### Log Patterns

Monitor gateway logs to verify tool execution:

```bash
tail -f ~/.openclaw/logs/gateway.log
```

Key log entries:
- `[feishu] received message from ...` - incoming message
- `[feishu] dispatching to agent` - sent to agent
- `[feishu] added typing indicator reaction` - bot is processing
- `[feishu] deliver called: text=...` - agent response
- `[feishu] dispatch complete` - response sent

### Verify Tool Usage

Ask bot explicitly to confirm tool usage:

```
use feishu_doc tool to read YOUR_DOC_TOKEN
```

Look for confirmation in response like:
> "我已经用 **Feishu Doc Tool** 读过了这个文档"

## Common Errors

### Permission Error (99991672)

```
Access denied. One of the following scopes is required: [contact:contact.base:readonly...]
```

This means bot lacks contact permission. Doesn't affect core messaging but prevents resolving sender names.

### Other Log Locations

```bash
# Error logs
tail -f ~/.openclaw/logs/gateway.err.log

# All log files
ls -la ~/.openclaw/logs/

# Raw agent session records (tool calls, responses, etc.)
ls ~/.openclaw/agents/main/sessions/
# View specific session
cat ~/.openclaw/agents/main/sessions/<session-id>.json
```

## Test Workflow

1. Start browser: `agent-browser --headed --session feishu-test open "https://feishu.cn/next/messenger"`
2. User scans QR to login
3. Search for bot: `Cmd+K` → type bot name → `Enter`
4. Focus input: press `/` then `Backspace`
5. Type message (English only, letter by letter)
6. Press `Enter` to send
7. Wait 10-20 seconds for response
8. Take screenshot and check logs to verify

## Testing feishu_doc Tool

```bash
# 1. Focus input
agent-browser --session feishu-test press "/" && \
agent-browser --session feishu-test press "Backspace"

# 2. Type full doc URL
url="https://feishu.cn/docx/YOUR_DOC_ID"
for char in $(echo "$url" | grep -o .); do
  agent-browser --session feishu-test press "$char" 2>/dev/null || true
done

# 3. Send
agent-browser --session feishu-test press "Enter"

# 4. Wait and check logs
sleep 15 && tail -30 ~/.openclaw/logs/gateway.log
```
