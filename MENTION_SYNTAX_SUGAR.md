# Mention Syntax Sugar Feature

This PR adds a convenient syntax sugar for @mentions in Feishu messages.

## Problem
Previously, to mention users in Feishu messages, you had to construct the full HTML-like tags manually:
```html
<at user_id="ou_abc123">Username</at>
```

This is verbose and error-prone for developers.

## Solution
This PR introduces a simple syntax sugar that automatically parses `@user_id:name` format:

### Examples
```javascript
// Old way (still supported)
await sendMessage({ 
  text: '<at user_id="ou_mockuser123456789abcdef">Alice</at> Hello!',
  // ... 
});

// New way with syntax sugar ✨
await sendMessage({ 
  text: '@ou_mockuser123456789abcdef:Alice Hello!',
  // ... 
});

// Even shorter - name is optional
await sendMessage({ 
  text: '@ou_mockuser123456789abcdef Hello!',  // Will display the user ID
  // ... 
});
```

### Supported Formats
- `@ou_mockuser123456789abcdef:Alice` - Mention human users
- `@cli_mockbot987654321fedcba:BotAssistant` - Mention bots/apps
- `@ou_mockuser123456789abcdef` - Mention without display name (shows ID)

## Implementation Details

### 1. Added `parseMentionsFromText()` function
- Parses `@user_id:name` patterns using regex
- Extracts user ID and display name
- Automatically handles both human users (`ou_*`) and bots (`cli_*`)

### 2. Enhanced `formatMentionForText()` function  
- Automatically uses correct format for different target types:
  - Human users: `<at user_id="ou_*">name</at>`
  - Bots: `<at id="cli_*">name</at>`

### 3. Updated outbound adapter
- Automatically processes syntax sugar before sending
- Maintains backward compatibility with existing code
- Works with both `sendText` and `sendMedia` functions

## Benefits
- **Simpler syntax**: `@ou_mockuser123:Alice` vs `<at user_id="ou_mockuser123">Alice</at>`
- **Auto-detection**: Automatically handles human/bot mention formats
- **Backward compatible**: Existing code continues to work
- **Developer friendly**: More intuitive for developers coming from other platforms

## Testing
- Tested with human user mentions (`ou_mockuser*`)
- Tested with bot mentions (`cli_mockbot*`) 
- Verified backward compatibility
- Tested mixed mentions in single message

---

This enhancement makes the Feishu plugin more developer-friendly while maintaining full compatibility with existing implementations.