import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ResolvedFeishuAccount } from "../types.js";
import { hasFeishuToolEnabledForAnyAccount, resolveToolAccount } from "../tools-common/tool-exec.js";
import { createFeishuClient } from "../client.js";
import { resolveToolsConfig } from "../tools-config.js";
import { errorResult, json, parseTimeParams, parseTimeRange, storeTokenFromParams, type CalendarClient } from "./common.js";
import { runCalendarAction } from "./actions.js";
import { FeishuCalendarSchema, type FeishuCalendarParams } from "./schemas.js";
import { UserTokenExpiredError, UserTokenNotFoundError } from "../user-token.js";

export function registerFeishuCalendarTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_calendar: No config available, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_calendar: No Feishu accounts configured, skipping");
    return;
  }

  const calendarEnabled = hasFeishuToolEnabledForAnyAccount(api.config, "calendar");
  if (!calendarEnabled) {
    api.logger.debug?.("feishu_calendar: Calendar tools disabled");
    return;
  }

  api.registerTool(
    {
      name: "feishu_calendar",
      label: "Feishu Calendar",
      description:
        "飞书日历操作（需要用户提供 user_access_token）。Actions: get_primary(获取主日历), list_events(日程列表), get_event(日程详情), search_events(搜索), create_event(创建), update_event(更新), delete_event(删除)",
      parameters: FeishuCalendarSchema,
      async execute(_toolCallId, params) {
        try {
          // 解析账号
          const account = resolveToolAccount(api.config!);
          if (!account.enabled || !account.configured) {
            throw new Error(`Feishu account "${account.accountId}" is not available`);
          }

          // 检查工具开关
          const toolsCfg = resolveToolsConfig(account.config.tools);
          if (!toolsCfg.calendar) {
            throw new Error('Calendar tool is disabled for this account');
          }

          // 存储用户传入的 token
          storeTokenFromParams(account.accountId, params as Record<string, unknown>);

          // 解析时间参数（将日期字符串转为 Unix 时间戳）
          // 对于 create_event，自动估算结束时间
          const p = params as Record<string, unknown>;
          if (p.action === "create_event" && p.start_time) {
            const { start, end } = parseTimeRange(
              p.start_time as string,
              p.end_time as string | undefined,
              p.start_time as string,
              p.end_time as string | undefined
            );
            p.start_time = start;
            p.end_time = end;
          } else {
            parseTimeParams(p);
          }
          storeTokenFromParams(account.accountId, params as Record<string, unknown>);

          // 解析时间参数（将日期字符串转为 Unix 时间戳）
          parseTimeParams(params as Record<string, unknown>);
          storeTokenFromParams(account.accountId, params as Record<string, unknown>);

          // 创建客户端
          const client: CalendarClient = {
            accountId: account.accountId,
            creds: {
              accountId: account.accountId,
              appId: account.appId,
              appSecret: account.appSecret,
              domain: account.domain,
            },
          };

          // 执行操作
          const result = await runCalendarAction(client, params as FeishuCalendarParams);
          return json(result);
        } catch (err) {
          // 特殊处理 token 相关错误，返回友好提示
          if (err instanceof UserTokenExpiredError) {
            return json({
              error: err.message,
              token_expired: true,
              hint: "请提供新的 user_access_token（以 u- 开头）",
            });
          }
          if (err instanceof UserTokenNotFoundError) {
            return json({
              error: err.message,
              token_expired: true,
              hint: "请提供 user_access_token（以 u- 开头）",
            });
          }
          return errorResult(err);
        }
      },
    },
    { name: "feishu_calendar" }
  );

  api.logger.info?.("feishu_calendar: Registered feishu_calendar");
}
