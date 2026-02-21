import fs from "node:fs/promises";
import { PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER } from "./tool-result-context-guard.js";

type SessionEntry = {
  type?: string;
  message?: {
    role?: string;
    type?: string;
    toolCallId?: string;
    content?: unknown;
    details?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function isToolResultEntry(entry: SessionEntry): boolean {
  const msg = entry.message;
  if (!msg) {
    return false;
  }
  return msg.role === "toolResult" || msg.role === "tool" || msg.type === "toolResult";
}

/**
 * Persist tool result compaction to the session JSONL file.
 *
 * Reads the session file, replaces the content of compacted tool results
 * with the compaction placeholder, and writes back atomically.
 *
 * Follows the same atomic write pattern as session-file-repair.ts:
 * write to a temp file, then rename over the original.
 */
export async function persistToolResultCompaction(params: {
  sessionFile: string;
  compactedToolCallIds: Set<string>;
  placeholder?: string;
  warn?: (msg: string) => void;
}): Promise<{ persisted: boolean; updatedCount: number }> {
  const { sessionFile, compactedToolCallIds, warn } = params;
  const placeholder = params.placeholder ?? PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER;

  if (compactedToolCallIds.size === 0) {
    return { persisted: false, updatedCount: 0 };
  }

  let content: string;
  try {
    content = await fs.readFile(sessionFile, "utf-8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    warn?.(`tool result guard persistence: failed to read session file: ${reason}`);
    return { persisted: false, updatedCount: 0 };
  }

  const lines = content.split(/\r?\n/);
  let updatedCount = 0;
  let modified = false;

  const outputLines: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      outputLines.push(line);
      continue;
    }

    let entry: SessionEntry;
    try {
      entry = JSON.parse(line) as SessionEntry;
    } catch {
      // Keep unparseable lines as-is (session-file-repair handles these)
      outputLines.push(line);
      continue;
    }

    if (
      entry.type === "message" &&
      isToolResultEntry(entry) &&
      entry.message?.toolCallId &&
      compactedToolCallIds.has(entry.message.toolCallId)
    ) {
      // Replace tool result content with the compaction placeholder
      const msg = entry.message;
      const originalContent = msg.content;

      // Check if already compacted (content is already the placeholder)
      const isAlreadyCompacted =
        originalContent === placeholder ||
        (Array.isArray(originalContent) &&
          originalContent.length === 1 &&
          typeof originalContent[0] === "object" &&
          originalContent[0] !== null &&
          (originalContent[0] as { text?: unknown }).text === placeholder);

      if (!isAlreadyCompacted) {
        // Determine content format: string or content block array
        if (typeof originalContent === "string" || originalContent === undefined) {
          msg.content = placeholder;
        } else {
          msg.content = [{ type: "text", text: placeholder }];
        }
        delete msg.details;
        updatedCount++;
        modified = true;
      }
    }

    outputLines.push(JSON.stringify(entry));
  }

  if (!modified) {
    return { persisted: false, updatedCount: 0 };
  }

  // Atomic write: temp file + rename
  const tmpPath = `${sessionFile}.guard-persist-${process.pid}-${Date.now()}.tmp`;
  try {
    const stat = await fs.stat(sessionFile).catch(() => null);
    await fs.writeFile(tmpPath, outputLines.join("\n"), "utf-8");
    if (stat) {
      await fs.chmod(tmpPath, stat.mode);
    }
    await fs.rename(tmpPath, sessionFile);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Cleanup failure is non-fatal
    }
    const reason = err instanceof Error ? err.message : "unknown error";
    warn?.(`tool result guard persistence: failed to write session file: ${reason}`);
    return { persisted: false, updatedCount: 0 };
  }

  return { persisted: true, updatedCount };
}
