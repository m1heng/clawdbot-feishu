---
name: feishu-urgent
description: |
  Feishu urgent message (buzz) notifications. Activate when user mentions urgent, buzz, remind, or escalation for messages.
---

# Feishu Urgent Tool

Single tool `feishu_urgent` for sending urgent (buzz) notifications to recipients for an already-sent message.

## Overview

Urgent notifications (also called "buzz" in Feishu) send a strong push notification to specified recipients. Use this to escalate important messages that require immediate attention.

**Important**: The message must already be sent before sending an urgent notification. You need the `message_id` from a previously sent message.

## Urgency Types

| Type | Description | Cost |
|------|-------------|------|
| `app` | In-app buzz notification (popup + sound) | Free |
| `sms` | SMS push to recipient's phone | May incur cost |
| `phone` | Voice call to recipient's phone | May incur cost |

## Send App Urgent (Default)

```json
{
  "message_id": "om_xxx",
  "user_ids": ["ou_xxx"],
  "urgent_type": "app"
}
```

## Send SMS Urgent

```json
{
  "message_id": "om_xxx",
  "user_ids": ["ou_xxx"],
  "urgent_type": "sms"
}
```

## Send Phone Call Urgent

```json
{
  "message_id": "om_xxx",
  "user_ids": ["ou_xxx"],
  "urgent_type": "phone"
}
```

## Multiple Recipients

```json
{
  "message_id": "om_xxx",
  "user_ids": ["ou_xxx", "ou_yyy", "ou_zzz"],
  "urgent_type": "app"
}
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message_id` | Yes | Message ID to send urgent notification for (e.g., `om_xxx`). The message must already be sent. |
| `user_ids` | Yes | List of `open_id` values to buzz. Minimum 1 recipient. Recipients must be members of the chat where the message was sent. |
| `urgent_type` | No | Urgency delivery method: `app` (default), `sms`, or `phone`. |

## Response

```json
{
  "ok": true,
  "message_id": "om_xxx",
  "urgent_type": "app",
  "invalid_user_list": []
}
```

- `invalid_user_list`: List of user IDs that could not receive the urgent notification (e.g., not in the chat, or invalid ID).

## Configuration

```yaml
channels:
  feishu:
    tools:
      urgent: true  # default: true
```

## Permissions

- `im:message.urgent` - Send in-app urgent notifications
- `im:message.urgent:sms` - Send SMS urgent notifications (may incur cost)
- `im:message.urgent:phone` - Send phone call urgent notifications (may incur cost)

## Notes

- **Message must exist**: The `message_id` must be from a message that has already been sent. You cannot send urgent notifications for messages being composed.
- **Recipients must be chat members**: Users in `user_ids` must be members of the chat where the original message was sent.
- **Quota limits**: Urgent notifications have quotas (especially `sms` and `phone`). Error `230024` ("Reach the upper limit of urgent message") indicates quota exhausted. Contact your tenant admin or check Feishu admin console > Cost Center > Quota.
- **Invalid user IDs**: Returns HTTP 400 error if any user_id is invalid (not found or not in the chat).
- **Cost warning**: `sms` and `phone` types may incur costs on the tenant. Use `app` (default) for free notifications.
