import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEDUP_MAX_SIZE = 1_000;
const DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache for quick lookup
let processedMessageIds = new Map<string, number>();
let lastCleanupTime = Date.now();

// Persistent storage file path
const DEDUP_FILE_PATH = path.join(os.tmpdir(), "openclaw-feishu-dedup.json");

interface DedupStore {
  messages: Record<string, number>;
  lastCleanup: number;
}

// Load persistent dedup store from disk
function loadDedupStore(): DedupStore {
  try {
    if (fs.existsSync(DEDUP_FILE_PATH)) {
      const data = fs.readFileSync(DEDUP_FILE_PATH, "utf-8");
      const store = JSON.parse(data) as DedupStore;
      // Restore in-memory cache
      processedMessageIds = new Map(Object.entries(store.messages));
      lastCleanupTime = store.lastCleanup;
      return store;
    }
  } catch (err) {
    console.error("Failed to load dedup store:", err);
  }
  return { messages: {}, lastCleanup: Date.now() };
}

// Save dedup store to disk
function saveDedupStore(store: DedupStore): void {
  try {
    fs.writeFileSync(DEDUP_FILE_PATH, JSON.stringify(store), "utf-8");
  } catch (err) {
    console.error("Failed to save dedup store:", err);
  }
}

// Initialize: load persistent store on module load
loadDedupStore();

export function tryRecordMessage(messageId: string, scope = "default"): boolean {
  const now = Date.now();
  const dedupKey = `${scope}:${messageId}`;

  // Periodic cleanup
  if (now - lastCleanupTime > DEDUP_CLEANUP_INTERVAL_MS) {
    const store = loadDedupStore();
    const newMessages: Record<string, number> = {};
    
    for (const [id, ts] of Object.entries(store.messages)) {
      if (now - ts <= DEDUP_TTL_MS) {
        newMessages[id] = ts;
      }
    }
    
    processedMessageIds = new Map(Object.entries(newMessages));
    store.messages = newMessages;
    store.lastCleanup = now;
    saveDedupStore(store);
    lastCleanupTime = now;
  }

  // Check if already processed
  if (processedMessageIds.has(dedupKey)) {
    console.log(`[Dedup] Duplicate message detected: ${dedupKey}`);
    return false;
  }

  // Evict oldest if at capacity
  if (processedMessageIds.size >= DEDUP_MAX_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, ts] of processedMessageIds) {
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      processedMessageIds.delete(oldestKey);
    }
  }

  // Record and persist
  processedMessageIds.set(dedupKey, now);
  
  // Async save to disk (don't block)
  const store = loadDedupStore();
  store.messages[dedupKey] = now;
  saveDedupStore(store);

  return true;
}

// Export for debugging
export function getDedupStats(): { size: number; oldestEntry: number | null } {
  let oldestEntry: number | null = null;
  for (const ts of processedMessageIds.values()) {
    if (oldestEntry === null || ts < oldestEntry) {
      oldestEntry = ts;
    }
  }
  return { size: processedMessageIds.size, oldestEntry };
}

export function clearDedupCache(): void {
  processedMessageIds = new Map();
  try {
    if (fs.existsSync(DEDUP_FILE_PATH)) {
      fs.unlinkSync(DEDUP_FILE_PATH);
    }
  } catch (err) {
    console.error("Failed to clear dedup cache:", err);
  }
}
