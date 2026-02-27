import { Type, type Static } from "@sinclair/typebox";

const UserIdTypeSchema = Type.Union(
  [Type.Literal("open_id"), Type.Literal("union_id"), Type.Literal("user_id")],
  { description: "Feishu user ID type used by API query parameters" },
);

const EventTimeObjectSchema = Type.Object({
  date: Type.Optional(Type.String({ description: "All-day date in YYYY-MM-DD format" })),
  timestamp: Type.Optional(Type.String({ description: "Unix timestamp in seconds as string" })),
  timezone: Type.Optional(Type.String({ description: "Timezone, e.g. Asia/Shanghai" })),
});

const EventTimeSchema = Type.Union([
  Type.String({ description: "RFC3339 / YYYY-MM-DD / Unix timestamp (seconds)" }),
  EventTimeObjectSchema,
]);

const EventLocationSchema = Type.Object({
  name: Type.Optional(Type.String({ description: "Location display name" })),
  address: Type.Optional(Type.String({ description: "Location address" })),
  latitude: Type.Optional(Type.Number({ description: "Latitude in decimal degrees" })),
  longitude: Type.Optional(Type.Number({ description: "Longitude in decimal degrees" })),
});

const EventReminderSchema = Type.Object({
  minutes: Type.Number({
    description: "Reminder offset in minutes, range [-20160, 20160]",
    minimum: -20160,
    maximum: 20160,
  }),
});

const EventPatchDataSchema = Type.Object({
  summary: Type.Optional(Type.String({ description: "Event title" })),
  description: Type.Optional(Type.String({ description: "Event description" })),
  need_notification: Type.Optional(Type.Boolean({ description: "Whether to send notifications to attendees" })),
  start_time: Type.Optional(EventTimeObjectSchema),
  end_time: Type.Optional(EventTimeObjectSchema),
  visibility: Type.Optional(
    Type.Union([Type.Literal("default"), Type.Literal("public"), Type.Literal("private")], {
      description: "Event visibility",
    }),
  ),
  attendee_ability: Type.Optional(
    Type.Union([
      Type.Literal("none"),
      Type.Literal("can_see_others"),
      Type.Literal("can_invite_others"),
      Type.Literal("can_modify_event"),
    ], { description: "Attendee permission level" }),
  ),
  free_busy_status: Type.Optional(
    Type.Union([Type.Literal("busy"), Type.Literal("free")], { description: "Busy/free status shown on calendar" }),
  ),
  location: Type.Optional(EventLocationSchema),
  color: Type.Optional(Type.Number({ description: "Event color index" })),
  reminders: Type.Optional(Type.Array(EventReminderSchema, { description: "Reminder rules" })),
  recurrence: Type.Optional(Type.String({ description: "Recurrence rule string (RRULE)" })),
});

export const FeishuCalendarSchema = Type.Union([
  Type.Object({
    action: Type.Literal("calendar_list"),
    open_id: Type.String({ description: "The user's open_id used to fetch OAuth user token" }),
    page_size: Type.Optional(Type.Number({ minimum: 50, maximum: 200, description: "Page size (50-200)" })),
    page_token: Type.Optional(Type.String({ description: "Pagination token from previous response" })),
    sync_token: Type.Optional(Type.String({ description: "Incremental sync token from previous response" })),
  }),
  Type.Object({
    action: Type.Literal("calendar_primary"),
    open_id: Type.String({ description: "The user's open_id used to fetch OAuth user token" }),
    user_id_type: Type.Optional(UserIdTypeSchema),
  }),
  Type.Object({
    action: Type.Literal("event_list"),
    open_id: Type.String({ description: "The user's open_id used to fetch OAuth user token" }),
    calendar_id: Type.Optional(Type.String({ description: "Calendar ID; if omitted, uses primary calendar" })),
    page_size: Type.Optional(Type.Number({ minimum: 50, maximum: 200, description: "Page size (50-200)" })),
    anchor_time: Type.Optional(Type.String({ description: "RFC3339 or Unix timestamp in seconds" })),
    page_token: Type.Optional(Type.String({ description: "Pagination token from previous response" })),
    sync_token: Type.Optional(Type.String({ description: "Incremental sync token from previous response" })),
    start_time: Type.Optional(Type.String({ description: "RFC3339 or Unix timestamp in seconds" })),
    end_time: Type.Optional(Type.String({ description: "RFC3339 or Unix timestamp in seconds" })),
    user_id_type: Type.Optional(UserIdTypeSchema),
  }),
  Type.Object({
    action: Type.Literal("event_get"),
    open_id: Type.String({ description: "The user's open_id used to fetch OAuth user token" }),
    calendar_id: Type.Optional(Type.String({ description: "Calendar ID; if omitted, uses primary calendar" })),
    event_id: Type.String({ description: "Event ID" }),
    need_meeting_settings: Type.Optional(Type.Boolean({ description: "Whether to include meeting settings in response" })),
    need_attendee: Type.Optional(Type.Boolean({ description: "Whether to include attendee list in response" })),
    max_attendee_num: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Max attendees returned (1-100)" })),
    user_id_type: Type.Optional(UserIdTypeSchema),
  }),
  Type.Object({
    action: Type.Literal("event_create"),
    open_id: Type.String({ description: "The user's open_id used to fetch OAuth user token" }),
    calendar_id: Type.Optional(Type.String({ description: "Calendar ID; if omitted, uses primary calendar" })),
    summary: Type.String({ minLength: 1, description: "Event title" }),
    description: Type.Optional(Type.String({ description: "Event description" })),
    start_time: EventTimeSchema,
    end_time: EventTimeSchema,
    need_notification: Type.Optional(Type.Boolean({ description: "Whether to notify attendees about this creation" })),
    visibility: Type.Optional(
      Type.Union([Type.Literal("default"), Type.Literal("public"), Type.Literal("private")], {
        description: "Event visibility",
      }),
    ),
    attendee_ability: Type.Optional(
      Type.Union([
        Type.Literal("none"),
        Type.Literal("can_see_others"),
        Type.Literal("can_invite_others"),
        Type.Literal("can_modify_event"),
      ], { description: "Attendee permission level" }),
    ),
    free_busy_status: Type.Optional(
      Type.Union([Type.Literal("busy"), Type.Literal("free")], { description: "Busy/free status shown on calendar" }),
    ),
    location: Type.Optional(EventLocationSchema),
    color: Type.Optional(Type.Number({ description: "Event color index" })),
    reminders: Type.Optional(Type.Array(EventReminderSchema, { description: "Reminder rules" })),
    recurrence: Type.Optional(Type.String({ description: "Recurrence rule string (RRULE)" })),
    idempotency_key: Type.Optional(Type.String({ description: "Idempotency key to avoid duplicate event creation" })),
    user_id_type: Type.Optional(UserIdTypeSchema),
  }),
  Type.Object({
    action: Type.Literal("event_update"),
    open_id: Type.String({ description: "The user's open_id used to fetch OAuth user token" }),
    calendar_id: Type.Optional(Type.String({ description: "Calendar ID; if omitted, uses primary calendar" })),
    event_id: Type.String({ description: "Event ID" }),
    data: EventPatchDataSchema,
    user_id_type: Type.Optional(UserIdTypeSchema),
  }),
  Type.Object({
    action: Type.Literal("event_delete"),
    open_id: Type.String({ description: "The user's open_id used to fetch OAuth user token" }),
    calendar_id: Type.Optional(Type.String({ description: "Calendar ID; if omitted, uses primary calendar" })),
    event_id: Type.String({ description: "Event ID" }),
    need_notification: Type.Optional(Type.Boolean({ description: "Whether to notify attendees about deletion" })),
    user_id_type: Type.Optional(UserIdTypeSchema),
  }),
]);

export type FeishuCalendarParams = Static<typeof FeishuCalendarSchema>;
