import { FeishuClientCredentials } from "../client.js";
import {
  errorResult,
  json,
  runFeishuApiCall,
  type FeishuApiResponse,
} from "../tools-common/feishu-api.js";
import {
  getUserAccessToken,
  storeUserToken,
  type StoreUserTokenParams,
} from "../user-token.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

export { json, errorResult };

export type CalendarClient = {
  accountId: string;
  creds: FeishuClientCredentials;
};

/**
 * 带自动 token 刷新的日历 API 调用。
 * 1. 从缓存获取 user_access_token（可能自动刷新）
 * 2. 发起请求
 * 3. 如果遇到 token 过期，标记失效后重试一次
 */
export async function runCalendarApiCall<T extends FeishuApiResponse>(
  client: CalendarClient,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  body?: unknown
): Promise<T> {
  const { accountId, creds } = client;

  // 获取 token（自动处理刷新）
  const { token } = await getUserAccessToken({ accountId, creds });

  const doRequest = async (): Promise<T> => {
    const url = new URL(`${FEISHU_API_BASE}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    if (body && (method === "POST" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);
    const data = await response.json();
    return data as T;
  };

  try {
    return await runFeishuApiCall(
      `Calendar API ${method} ${path}`,
      doRequest,
      // 可重试的错误码由 runFeishuApiCall 统一处理
      { retryableCodes: [99991663, 99991664, 99991665] }
    );
  } catch (err) {
    // 如果是 token 过期错误，标记失效并重试一次
    const error = err as Error & { code?: number };
    if (error.code === 99991663 || error.code === 99991664 || error.code === 99991665) {
      // 标记 token 失效，强制刷新
      const { invalidateUserToken } = await import("../user-token.js");
      invalidateUserToken(accountId);

      // 重试一次
      const refreshed = await getUserAccessToken({ accountId, creds });
      const retryUrl = new URL(`${FEISHU_API_BASE}${path}`);
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) {
            retryUrl.searchParams.set(key, String(value));
          }
        }
      }

      const options: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${refreshed.token}`,
          "Content-Type": "application/json",
        },
      };

      if (body && (method === "POST" || method === "PATCH")) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(retryUrl.toString(), options);
      const data = await response.json();
      return data as T;
    }
    throw err;
  }
}

/**
 * 存储用户 token 到缓存。
 * 在工具执行时由调用方传入。
 */
export function storeUserCalendarToken(
  accountId: string,
  params: StoreUserTokenParams
): void {
  storeUserToken({ ...params, accountId });
}

/**
 * 将工具参数中的 token 存储到缓存。
 */
export function storeTokenFromParams(
  accountId: string,
  params: Record<string, unknown>
): void {
  const userAccessToken = params.user_access_token as string | undefined;
  const refreshToken = params.refresh_token as string | undefined;

  if (userAccessToken) {
    storeUserCalendarToken(accountId, {
      userAccessToken,
      refreshToken,
    });
  }
}

// ============ 时间解析函数 ============

/**
 * 解析时间表达式，支持：
 * - 纯数字（Unix时间戳）
 * - 日期：2026-02-26, 2026/02/26
 * - 相对日期：今天、明天、后天、本周一、下周五
 * - 带时间的表达式：今天下午3点半、今天15:30、明天上午9点
 */
function parseDateTimeExpression(expr: string): { date: Date; hasTime: boolean; hour?: number; minute?: number; isPM?: boolean } | null {
  const now = new Date();
  const lower = expr.toLowerCase().trim();
  
  let date = new Date(now);
  let hasTime = false;
  let hour: number | undefined;
  let minute = 0;
  let isPM = false;

  // 提取并移除上午/下午/晚上修饰词
  if (lower.includes("晚上") || lower.includes("下午") || lower.includes("上午") || lower.includes("早上") || lower.includes("凌晨")) {
    hasTime = true;
    if (lower.includes("下午") || lower.includes("晚上")) {
      isPM = true;
    }
  }

  // 日期部分解析
  let datePart = lower
    .replace(/上午|早上|凌晨/g, "")
    .replace(/下午|晚上/g, "")
    .trim();

  // 解析日期
  if (datePart === "今天" || datePart === "today") {
    date.setHours(0, 0, 0, 0);
  } else if (datePart === "明天" || datePart === "tomorrow") {
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
  } else if (datePart === "后天" || datePart === "day after tomorrow") {
    date.setDate(date.getDate() + 2);
    date.setHours(0, 0, 0, 0);
  } else if (datePart === "大后天") {
    date.setDate(date.getDate() + 3);
    date.setHours(0, 0, 0, 0);
  } else if (datePart.includes("周一") || datePart.includes("星期一") || datePart.includes("monday")) {
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekOffset = datePart.startsWith("下") ? 7 : (datePart.startsWith("上") ? -7 : 0);
    date.setDate(date.getDate() + mondayOffset + weekOffset);
    date.setHours(0, 0, 0, 0);
  } else if (datePart.includes("周二") || datePart.includes("星期二") || datePart.includes("tuesday")) {
    const day = date.getDay();
    const offset = day <= 2 ? 2 - day : 2 - day + 7;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
  } else if (datePart.includes("周三") || datePart.includes("星期三") || datePart.includes("wednesday")) {
    const day = date.getDay();
    const offset = day <= 3 ? 3 - day : 3 - day + 7;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
  } else if (datePart.includes("周四") || datePart.includes("星期四") || datePart.includes("thursday")) {
    const day = date.getDay();
    const offset = day <= 4 ? 4 - day : 4 - day + 7;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
  } else if (datePart.includes("周五") || datePart.includes("星期五") || datePart.includes("friday")) {
    const day = date.getDay();
    const offset = day <= 5 ? 5 - day : 5 - day + 7;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
  } else if (datePart.includes("周六") || datePart.includes("星期六") || datePart.includes("saturday")) {
    const day = date.getDay();
    const offset = day <= 6 ? 6 - day : 6 - day + 7;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
  } else if (datePart.includes("周日") || datePart.includes("星期日") || datePart.includes("星期天") || datePart.includes("sunday")) {
    const day = date.getDay();
    const offset = day === 0 ? 7 : 7 - day;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
  } else {
    // 尝试解析标准日期格式
    const standardDate = Date.parse(datePart);
    if (!isNaN(standardDate)) {
      date = new Date(standardDate);
    } else {
      // 没有日期部分，保持今天
      date.setHours(0, 0, 0, 0);
    }
  }

  // 解析时间部分
  // 匹配：3点半、3:30、15:30、3点30分、下午3点半等
  const timeMatch = expr.match(/(\d{1,2})[:：](\d{2})|(\d{1,2})点半|(\d{1,2})点(\d{1,2})?分?|(\d{1,2})点/);
  
  if (timeMatch) {
    hasTime = true;
    if (timeMatch[1] && timeMatch[2]) {
      // 格式：15:30 或 3:30
      hour = parseInt(timeMatch[1], 10);
      minute = parseInt(timeMatch[2], 10);
    } else if (timeMatch[3]) {
      // 格式：3点半
      hour = parseInt(timeMatch[3], 10);
      minute = 30;
    } else if (timeMatch[4] && timeMatch[5]) {
      // 格式：3点30分
      hour = parseInt(timeMatch[4], 10);
      minute = parseInt(timeMatch[5], 10) || 0;
    } else if (timeMatch[6]) {
      // 格式：3点
      hour = parseInt(timeMatch[6], 10);
      minute = 0;
    }
  }

  // 处理 12 小时制
  if (hour !== undefined) {
    if (isPM && hour < 12) {
      hour += 12;
    } else if (!isPM && hour === 12) {
      hour = 0;
    }
    date.setHours(hour, minute, 0, 0);
  }

  return { date, hasTime, hour, minute, isPM };
}

/**
 * 估算结束时间。
 * 如果只指定了开始时间，默认为开始时间后1小时
 */
function estimateEndTime(startTimestamp: number, expr: string): number {
  // 尝试从表达式中解析持续时间
  const durationMatch = expr.match(/(\d+)(?:个)?小时?半?|(\d+)(?:个)?半小时/);
  
  if (durationMatch) {
    if (durationMatch[2]) {
      // "半小时"
      return startTimestamp + 30 * 60;
    } else if (durationMatch[1]) {
      let hours = parseInt(durationMatch[1], 10);
      if (expr.includes("半")) {
        hours += 0.5;
      }
      return startTimestamp + hours * 60 * 60;
    }
  }
  
  // 默认1小时
  return startTimestamp + 60 * 60;
}

/**
 * 将时间参数转换为 Unix 时间戳（秒）。
 * 支持：
 * - 纯数字字符串（如 "1772073600"）直接转为时间戳
 * - 日期时间字符串（如 "今天下午3点半", "明天上午9点"）自动解析
 * - 标准日期格式（如 "2026-02-26 15:30"）
 * - Date 对象
 */
export function parseTimeToTimestamp(
  time: string | number | Date | undefined,
  _originalExpr?: string // 保留参数签名兼容
): string | undefined {
  if (time === undefined) return undefined;

  // 如果已经是数字或 Date
  if (typeof time === "number") {
    return String(time);
  }
  if (time instanceof Date) {
    return String(Math.floor(time.getTime() / 1000));
  }

  const trimmed = time.trim();

  // 纯数字字符串（Unix 时间戳）
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // 解析复杂时间表达式
  const parsed = parseDateTimeExpression(trimmed);
  if (parsed) {
    return String(Math.floor(parsed.date.getTime() / 1000));
  }

  // 尝试直接解析日期字符串
  const parsedDate = Date.parse(trimmed);
  if (!isNaN(parsedDate)) {
    return String(Math.floor(parsedDate / 1000));
  }

  // 无法解析，返回原值
  return trimmed;
}

/**
 * 解析时间范围参数。
 * 支持传入结束时间表达式（如 "4点"、"16:00"），自动计算时间戳
 */
export function parseTimeRange(
  startTime: string | number | Date | undefined,
  endTime: string | number | Date | undefined,
  originalStartExpr?: string,
  originalEndExpr?: string
): { start: string | undefined; end: string | undefined } {
  const start = parseTimeToTimestamp(startTime, originalStartExpr);
  
  let end: string | undefined;
  if (endTime !== undefined) {
    end = parseTimeToTimestamp(endTime, originalEndExpr);
  } else if (start && originalStartExpr) {
    // 估算结束时间
    const startTs = parseInt(start, 10);
    if (!isNaN(startTs)) {
      end = String(estimateEndTime(startTs, originalStartExpr));
    }
  }
  
  return { start, end };
}

/**
 * 解析工具参数中的时间字段。
 */
export function parseTimeParams(params: Record<string, unknown>): void {
  const timeFields = ["start_time", "end_time"];
  for (const field of timeFields) {
    if (params[field] !== undefined) {
      params[field] = parseTimeToTimestamp(params[field] as string | number | Date);
    }
  }
}
