type MediaUnderstandingDecisionLike = {
  capability?: string;
  outcome?: string;
  attachments?: Array<{
    attempts?: Array<{
      outcome?: string;
      reason?: string;
      provider?: string;
      model?: string;
    }>;
  }>;
};

export type AudioFailureResolution = {
  notice: string;
  outcome: string;
  reasons: string[];
  debugSummary: string;
};

function extractAudioDecisionReasons(decision: MediaUnderstandingDecisionLike): string[] {
  const reasons = (decision.attachments ?? [])
    .flatMap((attachment) => attachment.attempts ?? [])
    .map((attempt) => (typeof attempt.reason === "string" ? attempt.reason.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(reasons));
}

export function resolveExplicitAudioFailure(ctx: {
  MediaUnderstandingDecisions?: MediaUnderstandingDecisionLike[];
}): AudioFailureResolution | undefined {
  const decisions = Array.isArray(ctx.MediaUnderstandingDecisions)
    ? ctx.MediaUnderstandingDecisions
    : [];
  const decision = decisions.find((entry) => entry?.capability === "audio");
  if (!decision || decision.outcome === "success") {
    return undefined;
  }

  const outcome = String(decision.outcome ?? "unknown").toLowerCase();
  const reasons = extractAudioDecisionReasons(decision).map((value) => value.toLowerCase());
  const hasReason = (keyword: string) => reasons.some((reason) => reason.includes(keyword));
  const attempts = (decision.attachments ?? []).flatMap((attachment) => attachment.attempts ?? []);
  const hasFailedAttempt = attempts.some((attempt) => attempt.outcome === "failed");
  const hasSkippedAttemptWithReason = attempts.some(
    (attempt) => attempt.outcome === "skipped" && Boolean(attempt.reason?.trim()),
  );
  // Emit user-facing notices only for explicit negative signals.
  const hasExplicitFailure =
    outcome === "disabled" ||
    outcome === "scope-deny" ||
    outcome === "no-attachment" ||
    hasFailedAttempt ||
    hasSkippedAttemptWithReason;
  if (!hasExplicitFailure) {
    return undefined;
  }

  const attemptSummary = attempts
    .map((attempt) => {
      const provider = attempt.provider?.trim() || "unknown";
      const model = attempt.model?.trim();
      const status = attempt.outcome?.trim() || "unknown";
      const reason = attempt.reason?.trim();
      const modelLabel = model ? `${provider}/${model}` : provider;
      return `${status}@${modelLabel}${reason ? `(${reason})` : ""}`;
    })
    .join("; ");
  const debugSummary = `outcome=${outcome}; reasons=${reasons.join(" | ") || "none"}; attempts=${
    attemptSummary || "none"
  }`;

  if (outcome === "disabled") {
    return {
      notice: "Audio transcription is disabled (tools.media.audio.enabled=false). Please enable it and retry.",
      outcome,
      reasons,
      debugSummary,
    };
  }
  if (outcome === "scope-deny") {
    return {
      notice:
        "Audio transcription is blocked by scope policy. Use text input or adjust tools.media.audio.scope.",
      outcome,
      reasons,
      debugSummary,
    };
  }
  if (outcome === "no-attachment") {
    return {
      notice: "No recognizable audio attachment was found. Please resend the voice message.",
      outcome,
      reasons,
      debugSummary,
    };
  }
  if (hasReason("maxbytes") || hasReason("exceeds")) {
    return {
      notice: "Audio file exceeds the configured size limit and cannot be transcribed.",
      outcome,
      reasons,
      debugSummary,
    };
  }
  if (
    hasReason("api key") ||
    (hasReason("provider") && hasReason("not available")) ||
    hasReason("authentication") ||
    hasReason("http 401") ||
    hasReason("http 403")
  ) {
    return {
      notice:
        "Audio transcription provider is unavailable. Check tools.media.audio provider/API key configuration.",
      outcome,
      reasons,
      debugSummary,
    };
  }
  if (hasReason("unsupported") || hasReason("mime") || hasReason("format")) {
    return {
      notice: "Audio format is unsupported. Please retry or send text.",
      outcome,
      reasons,
      debugSummary,
    };
  }
  if (outcome === "skipped" && reasons.length === 0) {
    return {
      notice: "No available audio transcription model found. Configure tools.media.audio first.",
      outcome,
      reasons,
      debugSummary,
    };
  }

  return {
    notice: "Audio transcription failed. Please retry or send text.",
    outcome,
    reasons,
    debugSummary,
  };
}
