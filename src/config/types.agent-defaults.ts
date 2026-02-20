import type { ChannelId } from "../channels/plugins/types.js";
import type {
  BlockStreamingChunkConfig,
  BlockStreamingCoalesceConfig,
  HumanDelayConfig,
  TypingMode,
} from "./types.base.js";
import type {
  SandboxBrowserSettings,
  SandboxDockerSettings,
  SandboxPruneSettings,
} from "./types.sandbox.js";
import type { MemorySearchConfig } from "./types.tools.js";

/**
 * Per-turn field names that can be moved from the system prompt to user messages.
 * When in the system prompt, these change every inbound message and invalidate KV cache.
 */
export type KvCachePerTurnField =
  | "has_reply_context"
  | "has_forwarded_context"
  | "has_thread_starter"
  | "was_mentioned"
  | "sender_id";

/**
 * Per-channel section names that can be made static in the system prompt.
 * When dynamic, these change on channel switch and invalidate KV cache.
 */
export type KvCachePerChannelField =
  | "channel"
  | "user_identity"
  | "reactions"
  | "inline_buttons"
  | "runtime_channel"
  | "inbound_meta";

/**
 * Chat type values used for context matching in KV cache stability overrides.
 */
export type KvCacheChatType = "direct" | "group" | "channel";

/**
 * Context condition for KV cache stability overrides.
 * All specified fields must match (AND logic). Omitted fields match anything.
 * Array values use OR logic within the field.
 *
 * Follows the same identifier conventions as `allowFrom` and `toolsBySender`:
 * - Discord: numeric user IDs, guild IDs, channel IDs
 * - Telegram: numeric user/chat IDs
 * - Signal: E.164 phone numbers, UUIDs, group IDs
 * - WhatsApp: E.164 phone numbers
 * - Slack: Slack user/channel IDs
 *
 * Matching is case-insensitive. The `"*"` wildcard matches any value.
 */
export type KvCacheStabilityContextMatch = {
  /** Match on chat type. Single value or array (OR). */
  chatType?: KvCacheChatType | KvCacheChatType[];
  /** Match on channel/provider name (e.g., "telegram", "discord"). Single or array (OR). */
  channel?: string | string[];
  /**
   * Match on specific sender IDs. Platform-specific format:
   * - Discord: user ID (e.g., "123456789")
   * - Telegram: numeric user ID
   * - Signal: E.164 ("+1234567890") or UUID
   * - WhatsApp: E.164
   * - Slack: Slack user ID (e.g., "U12345678")
   *
   * Matched against senderId, senderE164, and senderUsername (case-insensitive).
   * Use `"*"` to match any sender.
   */
  sender?: Array<string | number>;
  /**
   * Match on specific group/guild IDs. Platform-specific format:
   * - Discord: guild ID
   * - Telegram: group chat ID (negative number)
   * - Signal: group ID
   * - WhatsApp: group JID
   * - Slack: workspace ID
   *
   * Use `"*"` to match any group.
   */
  group?: Array<string | number>;
  /**
   * Match on specific channel/room IDs within a group. Platform-specific format:
   * - Discord: channel ID within a guild
   * - Slack: channel ID (e.g., "C12345678")
   * - Telegram: topic ID within a supergroup
   *
   * Use `"*"` to match any group channel.
   */
  groupChannel?: Array<string | number>;
  /** Match when the sender is (or is not) an owner/admin. */
  senderIsOwner?: boolean;
  /** Match when the session is (or is not) a subagent. */
  isSubagent?: boolean;
};

/**
 * A context-aware override for KV cache stability.
 * When the `when` condition matches the current message context,
 * these perTurnFields/perChannelFields replace the base config values.
 */
export type KvCacheStabilityOverride = {
  /** Condition that must match for this override to apply. */
  when: KvCacheStabilityContextMatch;
  /**
   * Override per-turn fields. Same semantics as base config:
   * - `true`: move all per-turn fields
   * - `false`: disable per-turn field moving
   * - `string[]`: move only the listed fields
   */
  perTurnFields?: boolean | KvCachePerTurnField[];
  /**
   * Override per-channel fields. Same semantics as base config:
   * - `true`: make all channel sections static
   * - `false`: disable channel section stabilization
   * - `string[]`: make only the listed sections static
   */
  perChannelFields?: boolean | KvCachePerChannelField[];
};

/**
 * Runtime context passed to KV cache stability resolution.
 * Populated from the current message/session state at each call site.
 */
export type KvCacheStabilityContext = {
  chatType?: KvCacheChatType;
  channel?: string;
  senderId?: string;
  senderE164?: string;
  senderUsername?: string;
  groupId?: string;
  groupChannel?: string;
  senderIsOwner?: boolean;
  isSubagent?: boolean;
};

/**
 * KV cache stability configuration.
 *
 * Moves dynamic metadata from the system prompt to user message prefixes so the
 * system prompt stays stable across turns and channel switches. This keeps the
 * KV-cache prefix intact on local LLM backends (llama.cpp, vLLM, etc.).
 *
 * **Off by default.** Only enable for local backends where KV-cache reuse matters.
 *
 * See docs/concepts/kv-cache-stability.md for per-field security documentation.
 */
export type KvCacheStabilityConfig = {
  /**
   * Move per-turn dynamic flags from the system prompt to user messages.
   * - `true`: move all per-turn fields
   * - `false` or absent: keep default behavior
   * - `string[]`: move only the listed fields
   */
  perTurnFields?: boolean | KvCachePerTurnField[];
  /**
   * Make channel-specific system prompt sections static (covering all configured
   * channels) and add a per-message channel identifier to user messages.
   * - `true`: make all channel sections static
   * - `false` or absent: keep default behavior
   * - `string[]`: make only the listed sections static
   */
  perChannelFields?: boolean | KvCachePerChannelField[];
  /**
   * Context-aware overrides. First matching override wins, falling back to
   * the base perTurnFields/perChannelFields above.
   *
   * Use this to disable or restrict KV cache stability in specific contexts
   * (e.g., disable in groups, restrict in DMs with non-owners).
   */
  overrides?: KvCacheStabilityOverride[];
};

export type AgentModelEntryConfig = {
  alias?: string;
  /** Provider-specific API parameters (e.g., GLM-4.7 thinking mode). */
  params?: Record<string, unknown>;
  /** Enable streaming for this model (default: true, false for Ollama to avoid SDK issue #1205). */
  streaming?: boolean;
  /** KV cache stability settings for this specific model. */
  kvCacheStability?: KvCacheStabilityConfig;
};

export type AgentModelListConfig = {
  primary?: string;
  fallbacks?: string[];
};

export type AgentContextPruningConfig = {
  mode?: "off" | "cache-ttl";
  /** TTL to consider cache expired (duration string, default unit: minutes). */
  ttl?: string;
  keepLastAssistants?: number;
  softTrimRatio?: number;
  hardClearRatio?: number;
  minPrunableToolChars?: number;
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  softTrim?: {
    maxChars?: number;
    headChars?: number;
    tailChars?: number;
  };
  hardClear?: {
    enabled?: boolean;
    placeholder?: string;
  };
};

export type CliBackendConfig = {
  /** CLI command to execute (absolute path or on PATH). */
  command: string;
  /** Base args applied to every invocation. */
  args?: string[];
  /** Output parsing mode (default: json). */
  output?: "json" | "text" | "jsonl";
  /** Output parsing mode when resuming a CLI session. */
  resumeOutput?: "json" | "text" | "jsonl";
  /** Prompt input mode (default: arg). */
  input?: "arg" | "stdin";
  /** Max prompt length for arg mode (if exceeded, stdin is used). */
  maxPromptArgChars?: number;
  /** Extra env vars injected for this CLI. */
  env?: Record<string, string>;
  /** Env vars to remove before launching this CLI. */
  clearEnv?: string[];
  /** Flag used to pass model id (e.g. --model). */
  modelArg?: string;
  /** Model aliases mapping (config model id → CLI model id). */
  modelAliases?: Record<string, string>;
  /** Flag used to pass session id (e.g. --session-id). */
  sessionArg?: string;
  /** Extra args used when resuming a session (use {sessionId} placeholder). */
  sessionArgs?: string[];
  /** Alternate args to use when resuming a session (use {sessionId} placeholder). */
  resumeArgs?: string[];
  /** When to pass session ids. */
  sessionMode?: "always" | "existing" | "none";
  /** JSON fields to read session id from (in order). */
  sessionIdFields?: string[];
  /** Flag used to pass system prompt. */
  systemPromptArg?: string;
  /** System prompt behavior (append vs replace). */
  systemPromptMode?: "append" | "replace";
  /** When to send system prompt. */
  systemPromptWhen?: "first" | "always" | "never";
  /** Flag used to pass image paths. */
  imageArg?: string;
  /** How to pass multiple images. */
  imageMode?: "repeat" | "list";
  /** Serialize runs for this CLI. */
  serialize?: boolean;
  /** Runtime reliability tuning for this backend's process lifecycle. */
  reliability?: {
    /** No-output watchdog tuning (fresh vs resumed runs). */
    watchdog?: {
      /** Fresh/new sessions (non-resume). */
      fresh?: {
        /** Fixed watchdog timeout in ms (overrides ratio when set). */
        noOutputTimeoutMs?: number;
        /** Fraction of overall timeout used when fixed timeout is not set. */
        noOutputTimeoutRatio?: number;
        /** Lower bound for computed watchdog timeout. */
        minMs?: number;
        /** Upper bound for computed watchdog timeout. */
        maxMs?: number;
      };
      /** Resume sessions. */
      resume?: {
        /** Fixed watchdog timeout in ms (overrides ratio when set). */
        noOutputTimeoutMs?: number;
        /** Fraction of overall timeout used when fixed timeout is not set. */
        noOutputTimeoutRatio?: number;
        /** Lower bound for computed watchdog timeout. */
        minMs?: number;
        /** Upper bound for computed watchdog timeout. */
        maxMs?: number;
      };
    };
  };
};

export type AgentDefaultsConfig = {
  /** Primary model and fallbacks (provider/model). */
  model?: AgentModelListConfig;
  /** Optional image-capable model and fallbacks (provider/model). */
  imageModel?: AgentModelListConfig;
  /** Model catalog with optional aliases (full provider/model keys). */
  models?: Record<string, AgentModelEntryConfig>;
  /** KV cache stability: move dynamic metadata to user messages for local LLM backends. */
  kvCacheStability?: KvCacheStabilityConfig;
  /** Agent working directory (preferred). Used as the default cwd for agent runs. */
  workspace?: string;
  /** Optional repository root for system prompt runtime line (overrides auto-detect). */
  repoRoot?: string;
  /** Skip bootstrap (BOOTSTRAP.md creation, etc.) for pre-configured deployments. */
  skipBootstrap?: boolean;
  /** Max chars for injected bootstrap files before truncation (default: 20000). */
  bootstrapMaxChars?: number;
  /** Max total chars across all injected bootstrap files (default: 150000). */
  bootstrapTotalMaxChars?: number;
  /** Optional IANA timezone for the user (used in system prompt; defaults to host timezone). */
  userTimezone?: string;
  /** Time format in system prompt: auto (OS preference), 12-hour, or 24-hour. */
  timeFormat?: "auto" | "12" | "24";
  /**
   * Envelope timestamp timezone: "utc" (default), "local", "user", or an IANA timezone string.
   */
  envelopeTimezone?: string;
  /**
   * Include absolute timestamps in message envelopes ("on" | "off", default: "on").
   */
  envelopeTimestamp?: "on" | "off";
  /**
   * Include elapsed time in message envelopes ("on" | "off", default: "on").
   */
  envelopeElapsed?: "on" | "off";
  /** Optional context window cap (used for runtime estimates + status %). */
  contextTokens?: number;
  /** Optional CLI backends for text-only fallback (claude-cli, etc.). */
  cliBackends?: Record<string, CliBackendConfig>;
  /** Opt-in: prune old tool results from the LLM context to reduce token usage. */
  contextPruning?: AgentContextPruningConfig;
  /** Compaction tuning and pre-compaction memory flush behavior. */
  compaction?: AgentCompactionConfig;
  /** Vector memory search configuration (per-agent overrides supported). */
  memorySearch?: MemorySearchConfig;
  /** Default thinking level when no /think directive is present. */
  thinkingDefault?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Default verbose level when no /verbose directive is present. */
  verboseDefault?: "off" | "on" | "full";
  /** Default elevated level when no /elevated directive is present. */
  elevatedDefault?: "off" | "on" | "ask" | "full";
  /** Default block streaming level when no override is present. */
  blockStreamingDefault?: "off" | "on";
  /**
   * Block streaming boundary:
   * - "text_end": end of each assistant text content block (before tool calls)
   * - "message_end": end of the whole assistant message (may include tool blocks)
   */
  blockStreamingBreak?: "text_end" | "message_end";
  /** Soft block chunking for streamed replies (min/max chars, prefer paragraph/newline). */
  blockStreamingChunk?: BlockStreamingChunkConfig;
  /**
   * Block reply coalescing (merge streamed chunks before send).
   * idleMs: wait time before flushing when idle.
   */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  /** Human-like delay between block replies. */
  humanDelay?: HumanDelayConfig;
  timeoutSeconds?: number;
  /** Max inbound media size in MB for agent-visible attachments (text note or future image attach). */
  mediaMaxMb?: number;
  /**
   * Max image side length (pixels) when sanitizing base64 image payloads in transcripts/tool results.
   * Default: 1200.
   */
  imageMaxDimensionPx?: number;
  typingIntervalSeconds?: number;
  /** Typing indicator start mode (never|instant|thinking|message). */
  typingMode?: TypingMode;
  /** Periodic background heartbeat runs. */
  heartbeat?: {
    /** Heartbeat interval (duration string, default unit: minutes; default: 30m). */
    every?: string;
    /** Optional active-hours window (local time); heartbeats run only inside this window. */
    activeHours?: {
      /** Start time (24h, HH:MM). Inclusive. */
      start?: string;
      /** End time (24h, HH:MM). Exclusive. Use "24:00" for end-of-day. */
      end?: string;
      /** Timezone for the window ("user", "local", or IANA TZ id). Default: "user". */
      timezone?: string;
    };
    /** Heartbeat model override (provider/model). */
    model?: string;
    /** Session key for heartbeat runs ("main" or explicit session key). */
    session?: string;
    /** Delivery target ("last", "none", or a channel id). */
    target?: "last" | "none" | ChannelId;
    /** Optional delivery override (E.164 for WhatsApp, chat id for Telegram). Supports :topic:NNN suffix for Telegram topics. */
    to?: string;
    /** Optional account id for multi-account channels. */
    accountId?: string;
    /** Override the heartbeat prompt body (default: "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK."). */
    prompt?: string;
    /** Max chars allowed after HEARTBEAT_OK before delivery (default: 30). */
    ackMaxChars?: number;
    /** Suppress tool error warning payloads during heartbeat runs. */
    suppressToolErrorWarnings?: boolean;
    /**
     * When enabled, deliver the model's reasoning payload for heartbeat runs (when available)
     * as a separate message prefixed with `Reasoning:` (same as `/reasoning on`).
     *
     * Default: false (only the final heartbeat payload is delivered).
     */
    includeReasoning?: boolean;
  };
  /** Max concurrent agent runs across all conversations. Default: 1 (sequential). */
  maxConcurrent?: number;
  /** Sub-agent defaults (spawned via sessions_spawn). */
  subagents?: {
    /** Max concurrent sub-agent runs (global lane: "subagent"). Default: 1. */
    maxConcurrent?: number;
    /** Maximum depth allowed for sessions_spawn chains. Default behavior: 1 (no nested spawns). */
    maxSpawnDepth?: number;
    /** Maximum active children a single requester session may spawn. Default behavior: 5. */
    maxChildrenPerAgent?: number;
    /** Auto-archive sub-agent sessions after N minutes (default: 60). */
    archiveAfterMinutes?: number;
    /** Default model selection for spawned sub-agents (string or {primary,fallbacks}). */
    model?: string | { primary?: string; fallbacks?: string[] };
    /** Default thinking level for spawned sub-agents (e.g. "off", "low", "medium", "high"). */
    thinking?: string;
  };
  /** Optional sandbox settings for non-main sessions. */
  sandbox?: {
    /** Enable sandboxing for sessions. */
    mode?: "off" | "non-main" | "all";
    /**
     * Agent workspace access inside the sandbox.
     * - "none": do not mount the agent workspace into the container; use a sandbox workspace under workspaceRoot
     * - "ro": mount the agent workspace read-only; disables write/edit tools
     * - "rw": mount the agent workspace read/write; enables write/edit tools
     */
    workspaceAccess?: "none" | "ro" | "rw";
    /**
     * Session tools visibility for sandboxed sessions.
     * - "spawned": only allow session tools to target the current session and sessions spawned from it (default)
     * - "all": allow session tools to target any session
     */
    sessionToolsVisibility?: "spawned" | "all";
    /** Container/workspace scope for sandbox isolation. */
    scope?: "session" | "agent" | "shared";
    /** Legacy alias for scope ("session" when true, "shared" when false). */
    perSession?: boolean;
    /** Root directory for sandbox workspaces. */
    workspaceRoot?: string;
    /** Docker-specific sandbox settings. */
    docker?: SandboxDockerSettings;
    /** Optional sandboxed browser settings. */
    browser?: SandboxBrowserSettings;
    /** Auto-prune sandbox containers. */
    prune?: SandboxPruneSettings;
  };
};

export type AgentCompactionMode = "default" | "safeguard";

export type AgentCompactionConfig = {
  /** Compaction summarization mode. */
  mode?: AgentCompactionMode;
  /** Pi reserve tokens target before floor enforcement. */
  reserveTokens?: number;
  /** Pi keepRecentTokens budget used for cut-point selection. */
  keepRecentTokens?: number;
  /** Minimum reserve tokens enforced for Pi compaction (0 disables the floor). */
  reserveTokensFloor?: number;
  /** Max share of context window for history during safeguard pruning (0.1–0.9, default 0.5). */
  maxHistoryShare?: number;
  /** Pre-compaction memory flush (agentic turn). Default: enabled. */
  memoryFlush?: AgentCompactionMemoryFlushConfig;
};

export type AgentCompactionMemoryFlushConfig = {
  /** Enable the pre-compaction memory flush (default: true). */
  enabled?: boolean;
  /** Run the memory flush when context is within this many tokens of the compaction threshold. */
  softThresholdTokens?: number;
  /** User prompt used for the memory flush turn (NO_REPLY is enforced if missing). */
  prompt?: string;
  /** System prompt appended for the memory flush turn. */
  systemPrompt?: string;
};
