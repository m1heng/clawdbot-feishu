// Structural subset of MediaUnderstandingDecision from openclaw/plugin-sdk.
// We only need capability and outcome for simple failure routing.
type AudioDecisionLike = {
  capability: string;
  outcome: string;
};

export type AudioFailureResolution = {
  notice: string;
  outcome: string;
};

export function resolveExplicitAudioFailure(ctx: {
  MediaUnderstandingDecisions?: AudioDecisionLike[];
}): AudioFailureResolution | undefined {
  const decisions = Array.isArray(ctx.MediaUnderstandingDecisions)
    ? ctx.MediaUnderstandingDecisions
    : [];
  const decision = decisions.find((entry) => entry?.capability === "audio");
  if (!decision || decision.outcome === "success") {
    return undefined;
  }

  const outcome = decision.outcome;

  switch (outcome) {
    case "disabled":
      return {
        notice: "Audio transcription is disabled. Please enable tools.media.audio and retry.",
        outcome,
      };
    case "scope-deny":
      return {
        notice:
          "Audio transcription is blocked by scope policy. Use text input or adjust tools.media.audio.scope.",
        outcome,
      };
    case "no-attachment":
      return {
        notice: "No recognizable audio attachment was found. Please resend the voice message.",
        outcome,
      };
    case "skipped":
      return {
        notice:
          "No audio transcription model is available. Please configure tools.media.audio first.",
        outcome,
      };
    default:
      return {
        notice: "Audio transcription failed. Please retry or send text.",
        outcome,
      };
  }
}
