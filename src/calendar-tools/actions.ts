import { type CalendarClient, runCalendarApiCall } from "./common.js";
import type { FeishuCalendarParams } from "./schemas.js";

// ============ Calendar API Response Types ============

type CalendarApiData = {
  code?: number;
  msg?: string;
  data?: {
    calendars?: Array<{ calendar?: CalendarInfo }>;
    items?: CalendarEvent[];
    has_more?: boolean;
    page_token?: string;
    sync_token?: string;
    event?: CalendarEvent;
  };
  log_id?: string;
};

interface CalendarInfo {
  calendar_id: string;
  summary?: string;
  description?: string;
  type?: string;
  role?: string;
}

interface CalendarEvent {
  event_id: string;
  summary?: string;
  description?: string;
  start_time?: { timestamp?: string; timezone?: string };
  end_time?: { timestamp?: string; timezone?: string };
  status?: string;
  event_organizer?: { display_name?: string };
  organizer?: { display_name?: string };
  location?: { name?: string };
  vchat?: { meeting_url?: string };
  app_link?: string;
  recurrence?: string;
  free_busy_status?: string;
  attendees?: unknown[];
  reminders?: unknown[];
  visibility?: string;
}

// ============ Actions ============

export async function getPrimaryCalendar(client: CalendarClient) {
  const res = await runCalendarApiCall<CalendarApiData>(client, "POST", "/calendar/v4/calendars/primary", {
    user_id_type: "user_id",
  });

  const calendar = res.data?.calendars?.[0]?.calendar;
  if (!calendar?.calendar_id) {
    throw new Error("无法获取主日历");
  }

  return {
    calendar_id: calendar.calendar_id,
    summary: calendar.summary,
    description: calendar.description,
    type: calendar.type,
    role: calendar.role,
  };
}

export async function listCalendarEvents(
  client: CalendarClient,
  calendarId: string | undefined,
  startTime: string,
  endTime: string,
  pageSize?: number,
  pageToken?: string
) {
  let calId = calendarId;
  if (!calId) {
    const primary = await getPrimaryCalendar(client);
    calId = primary.calendar_id;
  }

  const res = await runCalendarApiCall<CalendarApiData>(client, "GET", `/calendar/v4/calendars/${encodeURIComponent(calId)}/events`, {
    start_time: startTime,
    end_time: endTime,
    page_size: pageSize ?? 50,
    page_token: pageToken,
    user_id_type: "user_id",
  });

  const items = res.data?.items ?? [];
  const startTs = parseInt(startTime);
  const endTs = parseInt(endTime);

  // 过滤已取消的日程，重复性日程信任 API 返回结果
  const activeEvents = items.filter((e: CalendarEvent) => {
    if (e.status === "cancelled") return false;
    if (e.recurrence) return true;
    const eventStartTs = parseInt(e.start_time?.timestamp || "0");
    return eventStartTs >= startTs && eventStartTs < endTs;
  });

  return {
    calendar_id: calId,
    events: activeEvents.map((e: CalendarEvent) => ({
      event_id: e.event_id,
      summary: e.summary ?? "(无标题)",
      description: e.description,
      start_time: e.start_time,
      end_time: e.end_time,
      status: e.status,
      organizer: e.organizer?.display_name ?? e.event_organizer?.display_name,
      location: e.location?.name,
      meeting_url: e.vchat?.meeting_url,
      app_link: e.app_link,
      recurrence: e.recurrence,
      free_busy_status: e.free_busy_status,
    })),
    total: activeEvents.length,
    has_more: res.data?.has_more ?? false,
    page_token: res.data?.page_token,
    sync_token: res.data?.sync_token,
  };
}

export async function getCalendarEvent(
  client: CalendarClient,
  calendarId: string,
  eventId: string
) {
  const res = await runCalendarApiCall<CalendarApiData>(client, "GET", `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    user_id_type: "user_id",
  });

  const e = res.data?.event as CalendarEvent | undefined;
  if (!e) {
    throw new Error("日程不存在");
  }

  return {
    event_id: e.event_id,
    summary: e.summary ?? "(无标题)",
    description: e.description,
    start_time: e.start_time,
    end_time: e.end_time,
    status: e.status,
    organizer: e.organizer?.display_name ?? e.event_organizer?.display_name,
    attendees: e.attendees,
    location: e.location,
    meeting_url: e.vchat?.meeting_url,
    recurrence: e.recurrence,
    reminders: e.reminders,
    visibility: e.visibility,
    app_link: e.app_link,
  };
}

export async function searchCalendarEvents(
  client: CalendarClient,
  calendarId: string | undefined,
  query: string,
  startTime?: string,
  endTime?: string
) {
  let calId = calendarId;
  if (!calId) {
    const primary = await getPrimaryCalendar(client);
    calId = primary.calendar_id;
  }

  const filter: Record<string, unknown> = {};
  if (startTime) filter.start_time = { timestamp: startTime };
  if (endTime) filter.end_time = { timestamp: endTime };

  const body: Record<string, unknown> = { query };
  if (startTime || endTime) {
    body.filter = filter;
  }

  const res = await runCalendarApiCall<CalendarApiData>(client, "POST", `/calendar/v4/calendars/${encodeURIComponent(calId)}/events/search`, {
    user_id_type: "user_id",
  }, body);

  const items = res.data?.items ?? [];

  return {
    calendar_id: calId,
    events: items.map((e: CalendarEvent) => ({
      event_id: e.event_id,
      summary: e.summary ?? "(无标题)",
      description: e.description,
      start_time: e.start_time,
      end_time: e.end_time,
      status: e.status,
      organizer: e.organizer?.display_name ?? e.event_organizer?.display_name,
    })),
    total: items.length,
  };
}

export async function createCalendarEvent(
  client: CalendarClient,
  calendarId: string | undefined,
  summary: string,
  startTime: string,
  endTime: string,
  options: {
    description?: string;
    location?: string;
    need_notification?: boolean;
    reminders?: number[];
    recurrence?: string;
    attendee_ability?: string;
    free_busy_status?: string;
    visibility?: string;
  } = {}
) {
  let calId = calendarId;
  if (!calId) {
    const primary = await getPrimaryCalendar(client);
    calId = primary.calendar_id;
  }

  const body: Record<string, unknown> = {
    summary,
    start_time: {
      timestamp: startTime,
      timezone: "Asia/Shanghai",
    },
    end_time: {
      timestamp: endTime,
      timezone: "Asia/Shanghai",
    },
  };

  if (options.description) body.description = options.description;
  if (options.location) body.location = { name: options.location };
  if (options.need_notification !== undefined) body.need_notification = options.need_notification;
  if (options.reminders) body.reminders = options.reminders.map((m) => ({ minutes: m }));
  if (options.recurrence) body.recurrence = options.recurrence;
  if (options.attendee_ability) body.attendee_ability = options.attendee_ability;
  if (options.free_busy_status) body.free_busy_status = options.free_busy_status;
  if (options.visibility) body.visibility = options.visibility;

  const res = await runCalendarApiCall<CalendarApiData>(client, "POST", `/calendar/v4/calendars/${encodeURIComponent(calId)}/events`, {
    user_id_type: "user_id",
  }, body);

  const e = res.data?.event as CalendarEvent | undefined;
  return {
    success: true,
    calendar_id: calId,
    event_id: e?.event_id,
    summary: e?.summary,
    start_time: e?.start_time,
    end_time: e?.end_time,
    app_link: e?.app_link,
  };
}

export async function updateCalendarEvent(
  client: CalendarClient,
  calendarId: string,
  eventId: string,
  updates: {
    summary?: string;
    start_time?: string;
    end_time?: string;
    description?: string;
    location?: string;
    need_notification?: boolean;
  }
) {
  const body: Record<string, unknown> = {};

  if (updates.summary) body.summary = updates.summary;
  if (updates.description) body.description = updates.description;
  if (updates.location) body.location = { name: updates.location };
  if (updates.need_notification !== undefined) body.need_notification = updates.need_notification;
  if (updates.start_time) {
    body.start_time = {
      timestamp: updates.start_time,
      timezone: "Asia/Shanghai",
    };
  }
  if (updates.end_time) {
    body.end_time = {
      timestamp: updates.end_time,
      timezone: "Asia/Shanghai",
    };
  }

  const res = await runCalendarApiCall<CalendarApiData>(client, "PATCH", `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    user_id_type: "user_id",
  }, body);

  const e = res.data?.event as CalendarEvent | undefined;
  return {
    success: true,
    event_id: e?.event_id,
    summary: e?.summary,
    start_time: e?.start_time,
    end_time: e?.end_time,
    app_link: e?.app_link,
  };
}

export async function deleteCalendarEvent(
  client: CalendarClient,
  calendarId: string,
  eventId: string,
  needNotification: boolean = false
) {
  await runCalendarApiCall<CalendarApiData>(client, "DELETE", `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    need_notification: needNotification,
  });

  return {
    success: true,
    deleted_event_id: eventId,
  };
}

// ============ Action Dispatcher ============

export async function runCalendarAction(
  client: CalendarClient,
  params: FeishuCalendarParams
) {
  switch (params.action) {
    case "get_primary":
      return getPrimaryCalendar(client);

    case "list_events":
      return listCalendarEvents(
        client,
        params.calendar_id,
        params.start_time,
        params.end_time,
        params.page_size,
        params.page_token
      );

    case "get_event":
      return getCalendarEvent(client, params.calendar_id!, params.event_id!);

    case "search_events":
      return searchCalendarEvents(
        client,
        params.calendar_id,
        params.query,
        params.start_time,
        params.end_time
      );

    case "create_event":
      return createCalendarEvent(
        client,
        params.calendar_id,
        params.summary,
        params.start_time,
        params.end_time,
        {
          description: params.description,
          location: params.location,
          need_notification: params.need_notification,
          reminders: params.reminders,
          recurrence: params.recurrence,
          attendee_ability: params.attendee_ability,
          free_busy_status: params.free_busy_status,
          visibility: params.visibility,
        }
      );

    case "update_event":
      return updateCalendarEvent(
        client,
        params.calendar_id!,
        params.event_id!,
        {
          summary: params.summary,
          start_time: params.start_time,
          end_time: params.end_time,
          description: params.description,
          location: params.location,
          need_notification: params.need_notification,
        }
      );

    case "delete_event":
      return deleteCalendarEvent(
        client,
        params.calendar_id!,
        params.event_id!,
        params.need_notification
      );

    default:
      return { error: `Unknown action: ${(params as any).action}` };
  }
}
