export class MessageDeduplicator {
  private processed = new Map<string, number>();
  private readonly ttl: number;
  private readonly cleanupInterval: number;
  private lastCleanup: number = Date.now();

  constructor(ttlMs: number = 10 * 60 * 1000, cleanupIntervalMs: number = 60 * 1000) {
    this.ttl = ttlMs;
    this.cleanupInterval = cleanupIntervalMs;
  }

  /**
   * Checks if a message ID has been processed.
   * If not, marks it as processed.
   * @returns true if message was already processed (should be ignored), false if it's new.
   */
  checkAndMark(messageId: string): boolean {
    const now = Date.now();
    
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    if (this.processed.has(messageId)) {
      return true;
    }

    this.processed.set(messageId, now);
    return false;
  }

  private cleanup(now: number) {
    for (const [id, timestamp] of this.processed) {
      if (now - timestamp > this.ttl) {
        this.processed.delete(id);
      }
    }
  }
}
