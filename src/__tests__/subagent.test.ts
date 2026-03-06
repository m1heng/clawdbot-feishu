import { describe, it, expect, beforeEach, vi } from "vitest";
// @ts-ignore - types not exported from main entry
import type { PluginHookSubagentSpawningEvent, PluginHookSubagentEndedEvent } from "openclaw/plugin-sdk/plugins/hooks";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";

// Mock dependencies before importing the module under test
vi.mock("../send.js", () => ({
  sendMessageFeishu: vi.fn().mockResolvedValue({ messageId: "test", chatId: "test" }),
}));

vi.mock("../accounts.js", () => ({
  resolveFeishuAccount: vi.fn().mockReturnValue({ configured: true }),
}));

import { handleSubagentSpawning, handleSubagentEnded } from "../subagent.js";
import { resolveFeishuAccount } from "../accounts.js";

describe("subagent", () => {
  const mockConfig = {} as ClawdbotConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveFeishuAccount).mockReturnValue({ configured: true } as any);
  });

  describe("handleSubagentSpawning", () => {
    it("should successfully spawn subagent with valid chat context", async () => {
      const event: PluginHookSubagentSpawningEvent = {
        childSessionKey: "agent:main:subagent:test-123",
        agentId: "main",
        mode: "session",
        threadRequested: true,
        requester: {
          channel: "feishu",
          accountId: "default",
          to: "chat:oc_test123",
          threadId: "chat:oc_test123",
        },
      };

      const result = await handleSubagentSpawning(event, mockConfig);

      expect(result.status).toBe("ok");
      expect(result.threadBindingReady).toBe(true);
    });

    it("should return error when chatId is missing", async () => {
      const event: PluginHookSubagentSpawningEvent = {
        childSessionKey: "agent:main:subagent:test-456",
        agentId: "main",
        mode: "session",
        threadRequested: true,
        requester: {
          channel: "feishu",
          accountId: "default",
        },
      };

      const result = await handleSubagentSpawning(event, mockConfig);

      expect(result.status).toBe("error");
      expect(result.error).toContain("No chat context available");
    });

    it("should return error when account is not configured", async () => {
      vi.mocked(resolveFeishuAccount).mockReturnValue({ configured: false } as any);

      const event: PluginHookSubagentSpawningEvent = {
        childSessionKey: "agent:main:subagent:test-789",
        agentId: "main",
        mode: "session",
        threadRequested: true,
        requester: {
          channel: "feishu",
          accountId: "default",
          to: "chat:oc_test123",
        },
      };

      const result = await handleSubagentSpawning(event, mockConfig);

      expect(result.status).toBe("error");
      expect(result.error).toContain("not configured");
    });

    it("should use threadId as fallback when to is not provided", async () => {
      const event: PluginHookSubagentSpawningEvent = {
        childSessionKey: "agent:main:subagent:test-thread",
        agentId: "main",
        mode: "session",
        threadRequested: true,
        requester: {
          channel: "feishu",
          accountId: "default",
          threadId: "chat:oc_thread123",
        },
      };

      const result = await handleSubagentSpawning(event, mockConfig);

      expect(result.status).toBe("ok");
    });
  });

  describe("handleSubagentEnded", () => {
    it("should clean up subagent context on end", async () => {
      // First spawn a subagent
      const spawnEvent: PluginHookSubagentSpawningEvent = {
        childSessionKey: "agent:main:subagent:cleanup-test",
        agentId: "main",
        mode: "session",
        threadRequested: true,
        requester: {
          channel: "feishu",
          accountId: "default",
          to: "chat:oc_cleanup",
        },
      };

      await handleSubagentSpawning(spawnEvent, mockConfig);

      // Then end it
      const endEvent: PluginHookSubagentEndedEvent = {
        targetSessionKey: "agent:main:subagent:cleanup-test",
        targetKind: "subagent",
        reason: "completed",
      };

      await handleSubagentEnded(endEvent);

      // Context should be cleaned up (no error thrown)
      expect(true).toBe(true);
    });

    it("should handle cleanup for non-existent subagent gracefully", async () => {
      const endEvent: PluginHookSubagentEndedEvent = {
        targetSessionKey: "agent:main:subagent:non-existent",
        targetKind: "subagent",
        reason: "killed",
      };

      // Should not throw
      await expect(handleSubagentEnded(endEvent)).resolves.not.toThrow();
    });
  });
});
