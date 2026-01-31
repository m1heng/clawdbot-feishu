export type AgentTextPart = { type: "text"; text: string };
export type AgentThinkingPart = { type: "thinking"; text: string };
export type AgentToolCallPart = {
  type: "tool-call";
  toolName: string;
  toolUseId?: string;
  startedAt?: number;
};
export type AgentToolResultPart = {
  type: "tool-result";
  toolUseId?: string;
  text?: string;
  raw?: unknown;
  completedAt?: number;
  durationMs?: number;
};
export type AgentContentPart = AgentTextPart | AgentThinkingPart | AgentToolCallPart;
export type AgentAssistantMessage = { role: "assistant"; content: AgentContentPart[] };
export type AgentToolMessage = { role: "tool"; toolUseId?: string; content: AgentToolResultPart[] };
export type AgentCoreMessage = AgentAssistantMessage | AgentToolMessage;

export type TimelineEntry = {
  kind: "text" | "thinking" | "tool-call";
  content: string;
  toolUseId?: string;
  toolName?: string;
  durationMs?: number;
};

export interface MessageDisplayChunks {
  timeline: TimelineEntry[];
  finalText: string;
}

export enum AgentRunStatus {
  Idle = "idle",
  Thinking = "thinking",
  ToolCalling = "tool-calling",
  WaitingToolResult = "waiting-tool-result",
  Completed = "completed",
  Canceled = "canceled",
  Error = "error",
}

const statusTitles: Record<AgentRunStatus, string> = {
  [AgentRunStatus.Idle]: "等待指令",
  [AgentRunStatus.Thinking]: "思考中",
  [AgentRunStatus.ToolCalling]: "调用工具中",
  [AgentRunStatus.WaitingToolResult]: "等待工具结果",
  [AgentRunStatus.Completed]: "全部完成",
  [AgentRunStatus.Canceled]: "任务已取消",
  [AgentRunStatus.Error]: "执行异常",
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildToolCallContent(toolName: string, durationMs?: number) {
  const base = formatToolCall(toolName);
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    const seconds = Math.max(durationMs, 0) / 1000;
    const formatted = seconds.toFixed(1);
    const durationTag = `<text_tag color='turquoise'>耗时 ${formatted} 秒</text_tag>`;
    return `${base} ${durationTag}`;
  }
  return base;
}

function resolveDurationMs({
  reportedDurationMs,
  startedAt,
  completedAt,
}: {
  reportedDurationMs?: number;
  toolUseId?: string;
  startedAt?: number;
  completedAt?: number;
}) {
  if (typeof reportedDurationMs === "number") {
    return reportedDurationMs;
  }
  if (typeof startedAt === "number") {
    const end = typeof completedAt === "number" ? completedAt : Date.now();
    return Math.max(0, end - startedAt);
  }
  return undefined;
}

export function collectDisplayChunks(messages: AgentCoreMessage[]): MessageDisplayChunks {
  const timeline: TimelineEntry[] = [];
  const textParts: string[] = [];
  const toolEntryMap = new Map<
    string,
    { index: number; toolName: string; startedAt?: number; durationMs?: number }
  >();

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "text") {
          const normalized = normalizeWhitespace(content.text);
          if (normalized) {
            textParts.push(content.text.trim());
            timeline.push({ kind: "text", content: content.text.trim() });
          }
          continue;
        }
        if (content.type === "thinking") {
          const normalized = normalizeWhitespace(content.text);
          if (normalized) {
            timeline.push({ kind: "thinking", content: content.text.trim() });
          }
          continue;
        }
        if (content.type === "tool-call") {
          const toolName = content.toolName || "unknown-tool";
          const entry: TimelineEntry = {
            kind: "tool-call",
            toolName,
            toolUseId: content.toolUseId,
            content: buildToolCallContent(toolName),
          };
          const startedAt = content.startedAt;
          if (content.toolUseId) {
            toolEntryMap.set(content.toolUseId, {
              index: timeline.length,
              toolName,
              startedAt,
            });
          }
          timeline.push(entry);
        }
      }
      continue;
    }
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type !== "tool-result") {
          continue;
        }
        const toolUseId = part.toolUseId;
        if (!toolUseId) {
          continue;
        }
        const entryMeta = toolEntryMap.get(toolUseId);
        if (!entryMeta) {
          continue;
        }
        const entry = timeline[entryMeta.index];
        if (!entry) {
          continue;
        }
        const durationMs = resolveDurationMs({
          reportedDurationMs: part.durationMs,
          startedAt: entryMeta.startedAt,
          completedAt: part.completedAt,
        });
        entry.durationMs = durationMs;
        entry.content = buildToolCallContent(entryMeta.toolName, durationMs);
      }
    }
  }

  return { timeline, finalText: textParts.join("\n\n").trim() };
}

export function formatToolCall(toolName: string) {
  return `调用 \`'${toolName}'\` 工具`;
}

export type RenderState = {
  status: AgentRunStatus;
  headline: string;
  body: string;
  timeline: TimelineEntry[];
  finalAnswer?: string;
  isTimelineCollapsed: boolean;
  timelineMarkdown: string;
  showTimelinePanel: boolean;
};

export class AgentRunTracker {
  private status: AgentRunStatus = AgentRunStatus.Thinking;
  private readonly timeline: TimelineEntry[] = [];
  private readonly seen = new Set<string>();
  private draftAnswer = "";

  private getTimelineEntryKey(entry: TimelineEntry) {
    if (entry.kind === "tool-call" && entry.toolUseId) {
      return `tool:${entry.toolUseId}`;
    }
    return `${entry.kind}|${entry.content}`;
  }

  get currentStatus() {
    return this.status;
  }

  setStatus(status: AgentRunStatus) {
    this.status = status;
  }

  appendMessages(messages: AgentCoreMessage[]) {
    const { timeline, finalText } = collectDisplayChunks(messages);
    for (const entry of timeline) {
      const key = this.getTimelineEntryKey(entry);
      if (entry.content && !this.seen.has(key)) {
        this.seen.add(key);
        this.timeline.push(entry);
        continue;
      }
      if (entry.kind === "tool-call" && entry.toolUseId && entry.content) {
        const existingIndex = this.timeline.findIndex(
          (item) => item.toolUseId === entry.toolUseId,
        );
        if (existingIndex !== -1) {
          this.timeline[existingIndex] = entry;
        }
      }
    }
    if (finalText) {
      this.draftAnswer = finalText;
    }
  }

  setDraftAnswer(answer: string) {
    this.draftAnswer = answer;
  }

  reset() {
    this.timeline.length = 0;
    this.seen.clear();
    this.draftAnswer = "";
    this.status = AgentRunStatus.Thinking;
  }

  buildRenderState({ collapseTimeline }: { collapseTimeline: boolean }): RenderState {
    const headline = statusTitles[this.status];
    const showFinalAnswer = isTerminalStatus(this.status);
    const finalAnswerText = this.draftAnswer?.trim() || "";
    const filteredTimeline = this.filterTimelineEntries(
      this.timeline,
      showFinalAnswer ? finalAnswerText : undefined,
    );
    const timelineMarkdown = filteredTimeline
      .map((entry) => this.formatTimelineEntry(entry))
      .filter(Boolean)
      .join("\n");

    const hasTimeline = filteredTimeline.length > 0;

    let body: string;
    let finalAnswer: string | undefined;
    let showTimelinePanel = false;

    if (showFinalAnswer) {
      finalAnswer = finalAnswerText || undefined;
      showTimelinePanel = hasTimeline;
      body = finalAnswer || "暂无最终回复";
    } else {
      finalAnswer = undefined;
      showTimelinePanel = false;
      body = timelineMarkdown || this.draftAnswer || "思考中...";
    }

    return {
      status: this.status,
      headline,
      body,
      timeline: filteredTimeline,
      finalAnswer,
      isTimelineCollapsed: collapseTimeline,
      timelineMarkdown,
      showTimelinePanel,
    };
  }

  private formatTimelineEntry(entry: TimelineEntry) {
    if (!entry.content) {
      return "";
    }
    switch (entry.kind) {
      case "thinking":
        return `*思考*: ${entry.content}`;
      case "tool-call":
        return entry.content;
      default:
        return entry.content;
    }
  }

  private normalizeText(value?: string) {
    return (value ?? "").replace(/\s+/g, " ").trim();
  }

  private filterTimelineEntries(entries: TimelineEntry[], answerText?: string) {
    if (!answerText) {
      return entries.slice();
    }
    const normalizedAnswer = this.normalizeText(answerText);
    if (!normalizedAnswer) {
      return entries.slice();
    }
    return entries.filter((entry) => {
      if (entry.kind !== "text") {
        return true;
      }
      return this.normalizeText(entry.content) !== normalizedAnswer;
    });
  }
}

export function isTerminalStatus(status: AgentRunStatus) {
  return (
    status === AgentRunStatus.Completed ||
    status === AgentRunStatus.Canceled ||
    status === AgentRunStatus.Error
  );
}

export function buildLarkCard(state: RenderState) {
  const elements: Array<Record<string, unknown>> = [];

  if (state.showTimelinePanel && state.timeline.length > 0) {
    elements.push({
      tag: "collapsible_panel",
      expanded: !state.isTimelineCollapsed,
      header: {
        title: { tag: "plain_text", content: "执行过程" },
      },
      elements: [{ tag: "markdown", content: state.timelineMarkdown || "暂无过程记录" }],
    });
  }

  elements.push({ tag: "markdown", content: state.body || "思考中..." });

  const headerTemplate = (() => {
    switch (state.status) {
      case AgentRunStatus.Completed:
        return "green";
      case AgentRunStatus.ToolCalling:
        return "wathet";
      case AgentRunStatus.Canceled:
        return "orange";
      case AgentRunStatus.Error:
        return "red";
      case AgentRunStatus.Thinking:
        return "blue";
      default:
        return "grey";
    }
  })();

  const iconTemplate = (() => {
    switch (state.status) {
      case AgentRunStatus.Completed:
        return "succeed_filled";
      case AgentRunStatus.ToolCalling:
        return "setting-inter_filled";
      case AgentRunStatus.Canceled:
        return "ban_filled";
      case AgentRunStatus.Error:
        return "error_filled";
      case AgentRunStatus.Thinking:
        return "premium-gleam_filled";
      default:
        return "info_filled";
    }
  })();

  return {
    schema: "2.0",
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      template: headerTemplate,
      title: { tag: "plain_text", content: state.headline, text_size: "normal" },
      padding: "5px 12px 5px 12px",
      icon: { tag: "standard_icon", token: iconTemplate, color: headerTemplate },
    },
    body: {
      direction: "vertical",
      elements,
    },
  };
}
