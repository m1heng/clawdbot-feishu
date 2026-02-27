import * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createFeishuClient } from "./client.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { resolveToolsConfig } from "./tools-config.js";
import { userTokenStore } from "./user-token.js";
import { FeishuCalendarSchema, type FeishuCalendarParams } from "./calendar-schema.js";

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function toSecondsString(input: string): string {
  const value = input.trim();
  if (/^\d+$/.test(value)) return value;

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return String(Math.floor(parsed / 1000));

  throw new Error(`Invalid time format: ${input}`);
}

function normalizeEventTime(input: string | { date?: string; timestamp?: string; timezone?: string }) {
  if (typeof input !== "string") {
    if (!input.date && !input.timestamp) {
      throw new Error("event time object must include date or timestamp");
    }
    return input;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { date: input };
  }

  return { timestamp: toSecondsString(input) };
}

function defaultThisWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  return {
    start: String(Math.floor(weekStart.getTime() / 1000)),
    end: String(Math.floor(weekEnd.getTime() / 1000)),
  };
}

async function requestWithUserToken(
  client: Lark.Client,
  userAccessToken: string,
  request: {
    url: string;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    data?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
) {
  const resp = await client.request(request, Lark.withUserAccessToken(userAccessToken));
  if (resp.code !== 0) {
    throw new Error(`[${resp.code}] ${resp.msg || "Feishu API request failed"}`);
  }
  return resp.data;
}

async function resolvePrimaryCalendarId(
  client: Lark.Client,
  userAccessToken: string,
  userIdType?: "open_id" | "union_id" | "user_id",
): Promise<string> {
  const params = new URLSearchParams();
  if (userIdType) params.set("user_id_type", userIdType);
  const suffix = params.toString();
  const data = await requestWithUserToken(client, userAccessToken, {
    url: `open-apis/calendar/v4/calendars/primary${suffix ? `?${suffix}` : ""}`,
    method: "GET",
  });

  const calendarId = (data as { calendar?: { calendar_id?: string } })?.calendar?.calendar_id;
  if (!calendarId) {
    throw new Error("Failed to resolve primary calendar ID");
  }
  return calendarId;
}

export function registerFeishuCalendarTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_calendar: No config available, skipping");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_calendar: No Feishu accounts configured, skipping");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.calendar) {
    api.logger.debug?.("feishu_calendar: calendar tool disabled in config");
    return;
  }

  api.registerTool(
    {
      name: "feishu_calendar",
      label: "Feishu Calendar",
      description:
        "Manage Feishu calendars and events with user identity. " +
        "Actions: calendar_list, calendar_primary, event_list, event_get, event_create, event_update, event_delete. " +
        "Use feishu_user_auth first if user token is not available.",
      parameters: FeishuCalendarSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuCalendarParams;
        try {
          const userAccessToken = await userTokenStore.getValidAccessToken(
            p.open_id,
            firstAccount.appId!,
            firstAccount.appSecret!,
            firstAccount.domain,
          );

          if (!userAccessToken) {
            return json({
              error:
                "User has not authorized yet. " +
                "Use feishu_user_auth with action: 'authorize' and the user's open_id to generate an OAuth URL.",
            });
          }

          const client = createFeishuClient(firstAccount);

          switch (p.action) {
            case "calendar_list": {
              const query = new URLSearchParams();
              query.set("page_size", String(p.page_size ?? 50));
              if (p.page_token) query.set("page_token", p.page_token);
              if (p.sync_token) query.set("sync_token", p.sync_token);

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars?${query.toString()}`,
                method: "GET",
              });
              return json(data);
            }

            case "calendar_primary": {
              const query = new URLSearchParams();
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars/primary${query.size > 0 ? `?${query.toString()}` : ""}`,
                method: "GET",
              });
              return json(data);
            }

            case "event_list": {
              const calendarId =
                p.calendar_id ?? (await resolvePrimaryCalendarId(client, userAccessToken, p.user_id_type));
              const query = new URLSearchParams();
              query.set("page_size", String(p.page_size ?? 50));
              if (p.page_token) query.set("page_token", p.page_token);
              if (p.sync_token) query.set("sync_token", p.sync_token);
              if (p.anchor_time) query.set("anchor_time", toSecondsString(p.anchor_time));
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              if (p.start_time || p.end_time) {
                if (p.start_time) query.set("start_time", toSecondsString(p.start_time));
                if (p.end_time) query.set("end_time", toSecondsString(p.end_time));
              } else {
                const range = defaultThisWeekRange();
                query.set("start_time", range.start);
                query.set("end_time", range.end);
              }

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
                method: "GET",
              });
              return json(data);
            }

            case "event_get": {
              const calendarId =
                p.calendar_id ?? (await resolvePrimaryCalendarId(client, userAccessToken, p.user_id_type));
              const query = new URLSearchParams();
              query.set("need_meeting_settings", String(p.need_meeting_settings ?? false));
              query.set("need_attendee", String(p.need_attendee ?? true));
              query.set("max_attendee_num", String(p.max_attendee_num ?? 100));
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(p.event_id)}?${query.toString()}`,
                method: "GET",
              });
              return json(data);
            }

            case "event_create": {
              const calendarId =
                p.calendar_id ?? (await resolvePrimaryCalendarId(client, userAccessToken, p.user_id_type));
              const query = new URLSearchParams();
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              const body: Record<string, unknown> = {
                summary: p.summary,
                start_time: normalizeEventTime(p.start_time),
                end_time: normalizeEventTime(p.end_time),
              };

              if (p.description !== undefined) body.description = p.description;
              if (p.need_notification !== undefined) body.need_notification = p.need_notification;
              if (p.visibility !== undefined) body.visibility = p.visibility;
              if (p.attendee_ability !== undefined) body.attendee_ability = p.attendee_ability;
              if (p.free_busy_status !== undefined) body.free_busy_status = p.free_busy_status;
              if (p.location !== undefined) body.location = p.location;
              if (p.color !== undefined) body.color = p.color;
              if (p.reminders !== undefined) body.reminders = p.reminders;
              if (p.recurrence !== undefined) body.recurrence = p.recurrence;

              const headers: Record<string, string> = {};
              if (p.idempotency_key) headers["Idempotency-Key"] = p.idempotency_key;

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events${query.size > 0 ? `?${query.toString()}` : ""}`,
                method: "POST",
                data: body,
                headers,
              });
              return json(data);
            }

            case "event_update": {
              const calendarId =
                p.calendar_id ?? (await resolvePrimaryCalendarId(client, userAccessToken, p.user_id_type));
              const query = new URLSearchParams();
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              const dataPatch = p.data as Record<string, unknown>;
              if (Object.values(dataPatch).every((value) => value === undefined)) {
                return json({ error: "data must include at least one field to update" });
              }

              const body = {
                ...dataPatch,
                ...(dataPatch.start_time && {
                  start_time: normalizeEventTime(
                    dataPatch.start_time as string | { date?: string; timestamp?: string; timezone?: string },
                  ),
                }),
                ...(dataPatch.end_time && {
                  end_time: normalizeEventTime(
                    dataPatch.end_time as string | { date?: string; timestamp?: string; timezone?: string },
                  ),
                }),
              };

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(p.event_id)}${query.size > 0 ? `?${query.toString()}` : ""}`,
                method: "PATCH",
                data: body,
              });
              return json(data);
            }

            case "event_delete": {
              const calendarId =
                p.calendar_id ?? (await resolvePrimaryCalendarId(client, userAccessToken, p.user_id_type));
              const query = new URLSearchParams();
              query.set("need_notification", String(p.need_notification ?? true));

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(p.event_id)}?${query.toString()}`,
                method: "DELETE",
              });
              return json(data);
            }

            default:
              return json({ error: `Unknown action: ${(p as { action: string }).action}` });
          }
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_calendar" },
  );

  api.logger.info?.("feishu_calendar: Registered feishu_calendar tool");
}
