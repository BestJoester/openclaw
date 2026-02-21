import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER } from "./tool-result-context-guard.js";
import { persistToolResultCompaction } from "./tool-result-guard-persistence.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "guard-persist-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function sessionPath(): string {
  return path.join(tmpDir, "session.jsonl");
}

function makeEntry(msg: Record<string, unknown>): string {
  return JSON.stringify({ type: "message", message: msg });
}

describe("persistToolResultCompaction", () => {
  it("replaces matching tool results with placeholder (string content)", async () => {
    const lines = [
      JSON.stringify({ type: "session", id: "s1" }),
      makeEntry({ role: "user", content: "hello" }),
      makeEntry({ role: "assistant", content: [{ type: "text", text: "I'll search" }] }),
      makeEntry({
        role: "toolResult",
        toolCallId: "tc1",
        content: "very long tool output that should be compacted",
      }),
      makeEntry({ role: "assistant", content: [{ type: "text", text: "done" }] }),
    ];

    await fs.writeFile(sessionPath(), lines.join("\n") + "\n", "utf-8");

    const result = await persistToolResultCompaction({
      sessionFile: sessionPath(),
      compactedToolCallIds: new Set(["tc1"]),
    });

    expect(result.persisted).toBe(true);
    expect(result.updatedCount).toBe(1);

    const written = await fs.readFile(sessionPath(), "utf-8");
    const entries = written
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const toolResult = entries.find(
      (e: { message?: { toolCallId?: string } }) => e.message?.toolCallId === "tc1",
    );
    expect(toolResult.message.content).toBe(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER);
    expect(toolResult.message.details).toBeUndefined();
  });

  it("replaces matching tool results with placeholder (array content)", async () => {
    const lines = [
      JSON.stringify({ type: "session", id: "s1" }),
      makeEntry({
        role: "toolResult",
        toolCallId: "tc2",
        content: [{ type: "text", text: "long output" }],
        details: { some: "data" },
      }),
    ];

    await fs.writeFile(sessionPath(), lines.join("\n"), "utf-8");

    const result = await persistToolResultCompaction({
      sessionFile: sessionPath(),
      compactedToolCallIds: new Set(["tc2"]),
    });

    expect(result.persisted).toBe(true);
    expect(result.updatedCount).toBe(1);

    const written = await fs.readFile(sessionPath(), "utf-8");
    const entries = written
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const toolResult = entries.find(
      (e: { message?: { toolCallId?: string } }) => e.message?.toolCallId === "tc2",
    );
    expect(toolResult.message.content).toEqual([
      { type: "text", text: PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER },
    ]);
    expect(toolResult.message.details).toBeUndefined();
  });

  it("skips tool results not in the compacted set", async () => {
    const originalContent = "should not change";
    const lines = [
      JSON.stringify({ type: "session", id: "s1" }),
      makeEntry({ role: "toolResult", toolCallId: "tc3", content: originalContent }),
      makeEntry({ role: "toolResult", toolCallId: "tc4", content: "should be compacted" }),
    ];

    await fs.writeFile(sessionPath(), lines.join("\n"), "utf-8");

    await persistToolResultCompaction({
      sessionFile: sessionPath(),
      compactedToolCallIds: new Set(["tc4"]),
    });

    const written = await fs.readFile(sessionPath(), "utf-8");
    const entries = written
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const tc3 = entries.find(
      (e: { message?: { toolCallId?: string } }) => e.message?.toolCallId === "tc3",
    );
    expect(tc3.message.content).toBe(originalContent);
  });

  it("skips already-compacted tool results", async () => {
    const lines = [
      JSON.stringify({ type: "session", id: "s1" }),
      makeEntry({
        role: "toolResult",
        toolCallId: "tc5",
        content: PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER,
      }),
    ];

    await fs.writeFile(sessionPath(), lines.join("\n"), "utf-8");

    const result = await persistToolResultCompaction({
      sessionFile: sessionPath(),
      compactedToolCallIds: new Set(["tc5"]),
    });

    expect(result.persisted).toBe(false);
    expect(result.updatedCount).toBe(0);
  });

  it("returns not persisted when no IDs provided", async () => {
    const result = await persistToolResultCompaction({
      sessionFile: sessionPath(),
      compactedToolCallIds: new Set(),
    });

    expect(result.persisted).toBe(false);
    expect(result.updatedCount).toBe(0);
  });

  it("handles missing session file gracefully", async () => {
    const warnings: string[] = [];
    const result = await persistToolResultCompaction({
      sessionFile: path.join(tmpDir, "nonexistent.jsonl"),
      compactedToolCallIds: new Set(["tc1"]),
      warn: (msg) => warnings.push(msg),
    });

    expect(result.persisted).toBe(false);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("failed to read");
  });

  it("preserves non-tool-result entries", async () => {
    const lines = [
      JSON.stringify({ type: "session", id: "s1" }),
      makeEntry({ role: "user", content: "hello world" }),
      makeEntry({ role: "toolResult", toolCallId: "tc6", content: "big output" }),
      makeEntry({ role: "assistant", content: [{ type: "text", text: "reply" }] }),
    ];

    await fs.writeFile(sessionPath(), lines.join("\n"), "utf-8");

    await persistToolResultCompaction({
      sessionFile: sessionPath(),
      compactedToolCallIds: new Set(["tc6"]),
    });

    const written = await fs.readFile(sessionPath(), "utf-8");
    const entries = written
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    expect(entries[0]).toEqual({ type: "session", id: "s1" });
    expect(entries[1].message.content).toBe("hello world");
    expect(entries[3].message.content).toEqual([{ type: "text", text: "reply" }]);
  });
});
