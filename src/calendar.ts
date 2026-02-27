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
  if (/^\d+$/.test(value)) {
    // Accept both seconds and milliseconds.
    if (value.length >= 13) return String(Math.floor(Number(value) / 1000));
    return value;
  }

  // Parse date-only string in local timezone to avoid UTC-date drift.
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    return String(Math.floor(localDate.getTime() / 1000));
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return String(Math.floor(parsed / 1000));

  throw new Error(`Invalid time format: ${input}`);
}

function isDateOnlyString(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input.trim());
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

function parseLocalDateTimeToSeconds(input: string): string {
  const raw = input.trim();
  const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, year, month, day, hour, minute, second] = localMatch;
    const d = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0"),
      0,
    );
    return String(Math.floor(d.getTime() / 1000));
  }

  return toSecondsString(raw);
}

function normalizeEventTimeWithPreferredString(params: {
  preferred?: string;
  legacy?: string | { date?: string; timestamp?: string; timezone?: string };
  timezone?: string;
  fieldName: string;
}) {
  const { preferred, legacy, timezone, fieldName } = params;
  if (preferred) {
    return {
      timestamp: parseLocalDateTimeToSeconds(preferred),
      ...(timezone ? { timezone } : {}),
    };
  }
  if (legacy !== undefined) {
    const normalized = normalizeEventTime(legacy);
    if (
      timezone &&
      typeof normalized === "object" &&
      normalized !== null &&
      "timestamp" in normalized &&
      (normalized as { timestamp?: string }).timestamp
    ) {
      return { ...(normalized as { timestamp: string }), timezone };
    }
    return normalized;
  }
  throw new Error(`${fieldName} is required`);
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

function parseDateOnlyToSeconds(date: string): number {
  const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`);
  const [, year, month, day] = m;
  const d = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function getDateRangeByKeyword(keyword: "today" | "tomorrow" | "this_week" | "next_week"): {
  start: number;
  end: number;
} {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  if (keyword === "today") {
    const end = new Date(todayStart);
    end.setDate(todayStart.getDate() + 1);
    return { start: Math.floor(todayStart.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
  }

  if (keyword === "tomorrow") {
    const start = new Date(todayStart);
    start.setDate(todayStart.getDate() + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
  }

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  if (keyword === "next_week") {
    weekStart.setDate(weekStart.getDate() + 7);
  }
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return { start: Math.floor(weekStart.getTime() / 1000), end: Math.floor(weekEnd.getTime() / 1000) };
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
  log?: (message: string) => void,
): Promise<string> {
  try {
    const params = new URLSearchParams();
    if (userIdType) params.set("user_id_type", userIdType);
    const suffix = params.toString();
    const data = await requestWithUserToken(client, userAccessToken, {
      url: `open-apis/calendar/v4/calendars/primary${suffix ? `?${suffix}` : ""}`,
      method: "GET",
    });

    const calendarId = (data as { calendar?: { calendar_id?: string } })?.calendar?.calendar_id;
    if (calendarId) return calendarId;
  } catch (err) {
    log?.(`feishu_calendar: primary calendar lookup failed, fallback to list. err=${String(err)}`);
  }

  const listData = await requestWithUserToken(client, userAccessToken, {
    url: "open-apis/calendar/v4/calendars?page_size=50",
    method: "GET",
  });

  const calendars = (listData as { calendar_list?: Array<{ calendar_id?: string; role?: string }> })
    ?.calendar_list ?? [];
  const preferred = calendars.find((item) => item.calendar_id && item.role && item.role !== "reader");
  const fallback = calendars.find((item) => item.calendar_id);
  const calendarId = preferred?.calendar_id ?? fallback?.calendar_id;

  if (!calendarId) {
    throw new Error("Failed to resolve calendar_id (primary endpoint unavailable and no visible calendars found)");
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
              const calendarId = await resolvePrimaryCalendarId(
                client,
                userAccessToken,
                p.user_id_type,
                (msg) => api.logger.warn?.(msg),
              );
              return json({
                calendar: {
                  calendar_id: calendarId,
                },
              });
            }

            case "event_list": {
              const calendarId =
                p.calendar_id ??
                (await resolvePrimaryCalendarId(
                  client,
                  userAccessToken,
                  p.user_id_type,
                  (msg) => api.logger.warn?.(msg),
                ));
              const query = new URLSearchParams();
              query.set("page_size", String(p.page_size ?? 50));
              if (p.page_token) query.set("page_token", p.page_token);
              if (p.sync_token) query.set("sync_token", p.sync_token);
              if (p.anchor_time) query.set("anchor_time", toSecondsString(p.anchor_time));
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              if (p.date) {
                const startSec = parseDateOnlyToSeconds(p.date);
                query.set("start_time", String(startSec));
                query.set("end_time", String(startSec + 24 * 60 * 60));
              } else if (p.start_date || p.end_date) {
                if (p.start_date && p.end_date) {
                  query.set("start_time", String(parseDateOnlyToSeconds(p.start_date)));
                  query.set("end_time", String(parseDateOnlyToSeconds(p.end_date)));
                } else if (p.start_date) {
                  const startSec = parseDateOnlyToSeconds(p.start_date);
                  query.set("start_time", String(startSec));
                  query.set("end_time", String(startSec + 24 * 60 * 60));
                } else if (p.end_date) {
                  const endSec = parseDateOnlyToSeconds(p.end_date);
                  query.set("end_time", String(endSec));
                  query.set("start_time", String(endSec - 24 * 60 * 60));
                }
              } else if (p.date_range) {
                const range = getDateRangeByKeyword(p.date_range);
                query.set("start_time", String(range.start));
                query.set("end_time", String(range.end));
              } else if (p.start_time || p.end_time) {
                const hasStart = Boolean(p.start_time);
                const hasEnd = Boolean(p.end_time);

                if (hasStart && hasEnd) {
                  query.set("start_time", toSecondsString(p.start_time!));
                  query.set("end_time", toSecondsString(p.end_time!));
                } else if (hasStart) {
                  const startSec = Number(toSecondsString(p.start_time!));
                  query.set("start_time", String(startSec));
                  // For date-only input (e.g. "2026-02-27"), infer one-day range.
                  if (isDateOnlyString(p.start_time!)) {
                    query.set("end_time", String(startSec + 24 * 60 * 60));
                  }
                } else if (hasEnd) {
                  const endSec = Number(toSecondsString(p.end_time!));
                  query.set("end_time", String(endSec));
                  if (isDateOnlyString(p.end_time!)) {
                    query.set("start_time", String(endSec - 24 * 60 * 60));
                  }
                }
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
                p.calendar_id ??
                (await resolvePrimaryCalendarId(
                  client,
                  userAccessToken,
                  p.user_id_type,
                  (msg) => api.logger.warn?.(msg),
                ));
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
                p.calendar_id ??
                (await resolvePrimaryCalendarId(
                  client,
                  userAccessToken,
                  p.user_id_type,
                  (msg) => api.logger.warn?.(msg),
                ));
              const query = new URLSearchParams();
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              const body: Record<string, unknown> = {
                summary: p.summary,
                start_time: normalizeEventTimeWithPreferredString({
                  preferred: p.start_at,
                  legacy: p.start_time,
                  timezone: p.timezone,
                  fieldName: "start_at/start_time",
                }),
                end_time: normalizeEventTimeWithPreferredString({
                  preferred: p.end_at,
                  legacy: p.end_time,
                  timezone: p.timezone,
                  fieldName: "end_at/end_time",
                }),
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
                p.calendar_id ??
                (await resolvePrimaryCalendarId(
                  client,
                  userAccessToken,
                  p.user_id_type,
                  (msg) => api.logger.warn?.(msg),
                ));
              const query = new URLSearchParams();
              if (p.user_id_type) query.set("user_id_type", p.user_id_type);

              const dataPatch = p.data as Record<string, unknown>;
              if (Object.values(dataPatch).every((value) => value === undefined)) {
                return json({ error: "data must include at least one field to update" });
              }

              const patchStartAt = typeof dataPatch.start_at === "string" ? dataPatch.start_at : undefined;
              const patchEndAt = typeof dataPatch.end_at === "string" ? dataPatch.end_at : undefined;
              const patchTimezone = typeof dataPatch.timezone === "string" ? dataPatch.timezone : undefined;

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
                ...(patchStartAt && {
                  start_time: normalizeEventTimeWithPreferredString({
                    preferred: patchStartAt,
                    timezone: patchTimezone,
                    fieldName: "data.start_at",
                  }),
                }),
                ...(patchEndAt && {
                  end_time: normalizeEventTimeWithPreferredString({
                    preferred: patchEndAt,
                    timezone: patchTimezone,
                    fieldName: "data.end_at",
                  }),
                }),
              };

              delete (body as Record<string, unknown>).start_at;
              delete (body as Record<string, unknown>).end_at;
              delete (body as Record<string, unknown>).timezone;

              const data = await requestWithUserToken(client, userAccessToken, {
                url: `open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(p.event_id)}${query.size > 0 ? `?${query.toString()}` : ""}`,
                method: "PATCH",
                data: body,
              });
              return json(data);
            }

            case "event_delete": {
              const calendarId =
                p.calendar_id ??
                (await resolvePrimaryCalendarId(
                  client,
                  userAccessToken,
                  p.user_id_type,
                  (msg) => api.logger.warn?.(msg),
                ));
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
