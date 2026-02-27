import { Type, type Static } from "@sinclair/typebox";

export const FeishuMinutesSchema = Type.Object({
  action: Type.Literal("get_transcript"),
  minutes_token: Type.String({
    description:
      "Feishu Minutes token (24 characters), extracted from the minutes URL. " +
      "E.g., https://xxx.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx → obcnq3b9jl72l83w4f14xxxx",
    minLength: 24,
    maxLength: 24,
  }),
  open_id: Type.String({
    description: "The user's open_id (from message context) to look up user token for API access",
  }),
  need_speaker: Type.Optional(
    Type.Boolean({ description: "Include speaker names in transcript (default: true)" }),
  ),
  need_timestamp: Type.Optional(
    Type.Boolean({ description: "Include timestamps in transcript (default: false)" }),
  ),
  file_format: Type.Optional(
    Type.Union([Type.Literal("txt"), Type.Literal("srt")], {
      description: "Export format: txt or srt (default: txt)",
    }),
  ),
});

export type FeishuMinutesParams = Static<typeof FeishuMinutesSchema>;
