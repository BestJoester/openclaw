import type {
  KvCachePerChannelField,
  KvCachePerTurnField,
  KvCacheStabilityConfig,
  KvCacheStabilityContext,
  KvCacheStabilityContextMatch,
} from "./types.agent-defaults.js";
import type { OpenClawConfig } from "./types.openclaw.js";

const ALL_PER_TURN_FIELDS: KvCachePerTurnField[] = [
  "has_reply_context",
  "has_forwarded_context",
  "has_thread_starter",
  "was_mentioned",
  "sender_id",
];

const ALL_PER_CHANNEL_FIELDS: KvCachePerChannelField[] = [
  "channel",
  "user_identity",
  "reactions",
  "inline_buttons",
  "runtime_channel",
  "inbound_meta",
];

export type ResolvedKvCacheStability = {
  /** Set of per-turn field names to move from system prompt to user messages. Empty = none. */
  perTurnFields: Set<KvCachePerTurnField>;
  /** Set of per-channel section names to make static. Empty = none. */
  perChannelFields: Set<KvCachePerChannelField>;
};

/**
 * Resolve KV cache stability config for a given agent + model combination,
 * with optional context-aware overrides.
 *
 * Resolution order (most specific wins):
 * 1. agents.list[agentId].models["provider/model"].kvCacheStability
 * 2. agents.list[agentId].kvCacheStability
 * 3. agents.defaults.models["provider/model"].kvCacheStability
 * 4. agents.defaults.kvCacheStability
 * 5. Not set: feature disabled
 *
 * Within the selected config, if `overrides` exist and a `context` is provided,
 * the first override whose `when` condition matches the context replaces the
 * base perTurnFields/perChannelFields values.
 */
export function resolveKvCacheStability(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
  modelKey?: string;
  context?: KvCacheStabilityContext;
}): ResolvedKvCacheStability {
  const empty: ResolvedKvCacheStability = {
    perTurnFields: new Set(),
    perChannelFields: new Set(),
  };

  const { cfg, agentId, modelKey, context } = params;
  if (!cfg?.agents) {
    return empty;
  }

  const defaults = cfg.agents.defaults;
  const agentEntry = agentId ? cfg.agents.list?.find((a) => a.id === agentId) : undefined;

  // Collect candidates in order of specificity (most specific first)
  const candidates: (KvCacheStabilityConfig | undefined)[] = [
    // 1. Per-agent + per-model
    modelKey ? agentEntry?.models?.[modelKey]?.kvCacheStability : undefined,
    // 2. Per-agent
    agentEntry?.kvCacheStability,
    // 3. Per-model (global defaults)
    modelKey ? defaults?.models?.[modelKey]?.kvCacheStability : undefined,
    // 4. Global defaults
    defaults?.kvCacheStability,
  ];

  // Use the first non-undefined config found
  const effective = candidates.find((c) => c !== undefined);
  if (!effective) {
    return empty;
  }

  // Apply context-aware overrides if present
  let perTurn = effective.perTurnFields;
  let perChannel = effective.perChannelFields;

  if (effective.overrides && context) {
    const match = effective.overrides.find((o) => matchesContext(o.when, context));
    if (match) {
      perTurn = match.perTurnFields;
      perChannel = match.perChannelFields;
    }
  }

  return {
    perTurnFields: resolveFieldSet(perTurn, ALL_PER_TURN_FIELDS),
    perChannelFields: resolveFieldSet(perChannel, ALL_PER_CHANNEL_FIELDS),
  };
}

/**
 * Normalize a config identifier for case-insensitive matching.
 * Follows the same conventions as allowFrom / toolsBySender throughout the codebase.
 */
function norm(v: string | number | undefined | null): string {
  if (v == null) {
    return "";
  }
  return String(v).trim().toLowerCase();
}

/**
 * Check if a context matches a `when` condition.
 * All specified fields must match (AND logic). Omitted fields match anything.
 *
 * For identity fields (sender, group, groupChannel), matching follows the same
 * conventions as allowFrom / toolsBySender:
 * - Case-insensitive comparison
 * - `"*"` wildcard matches any value
 * - `sender` matches against senderId, senderE164, and senderUsername
 */
function matchesContext(when: KvCacheStabilityContextMatch, ctx: KvCacheStabilityContext): boolean {
  // chatType: string | string[]
  if (when.chatType !== undefined) {
    if (ctx.chatType === undefined) {
      return false;
    }
    const allowed = Array.isArray(when.chatType) ? when.chatType : [when.chatType];
    if (!allowed.includes(ctx.chatType)) {
      return false;
    }
  }

  // channel: string | string[]
  if (when.channel !== undefined) {
    if (ctx.channel === undefined) {
      return false;
    }
    const allowed = Array.isArray(when.channel) ? when.channel : [when.channel];
    if (!matchesStringList(allowed, ctx.channel)) {
      return false;
    }
  }

  // sender: (string|number)[] — matches against senderId, senderE164, senderUsername
  if (when.sender !== undefined) {
    if (!matchesSenderIdentity(when.sender, ctx)) {
      return false;
    }
  }

  // group: (string|number)[] — matches against groupId
  if (when.group !== undefined) {
    if (!matchesIdList(when.group, ctx.groupId)) {
      return false;
    }
  }

  // groupChannel: (string|number)[] — matches against groupChannel
  if (when.groupChannel !== undefined) {
    if (!matchesIdList(when.groupChannel, ctx.groupChannel)) {
      return false;
    }
  }

  // senderIsOwner: boolean
  if (when.senderIsOwner !== undefined) {
    if (ctx.senderIsOwner !== when.senderIsOwner) {
      return false;
    }
  }

  // isSubagent: boolean
  if (when.isSubagent !== undefined) {
    if (ctx.isSubagent !== when.isSubagent) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a string value matches a list of allowed values (case-insensitive, supports "*" wildcard).
 */
function matchesStringList(allowed: string[], value: string): boolean {
  const v = norm(value);
  return allowed.some((a) => {
    const n = norm(a);
    return n === "*" || n === v;
  });
}

/**
 * Check if a context value matches a list of IDs (case-insensitive, supports "*" wildcard).
 * Returns false if the context value is undefined/empty.
 */
function matchesIdList(allowed: Array<string | number>, value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const v = norm(value);
  return allowed.some((a) => {
    const n = norm(a);
    return n === "*" || n === v;
  });
}

/**
 * Check if any of the sender's identity fields match the allowed sender list.
 * Follows the same multi-field matching pattern as toolsBySender:
 * checks senderId, senderE164, and senderUsername.
 */
function matchesSenderIdentity(
  allowed: Array<string | number>,
  ctx: KvCacheStabilityContext,
): boolean {
  // Wildcard matches any sender (even if we don't know who they are)
  if (allowed.some((a) => norm(a) === "*")) {
    return true;
  }

  const candidates = [ctx.senderId, ctx.senderE164, ctx.senderUsername].filter(Boolean);
  if (candidates.length === 0) {
    return false;
  }

  return candidates.some((candidate) => matchesIdList(allowed, candidate));
}

function resolveFieldSet<T extends string>(
  value: boolean | T[] | undefined,
  allFields: T[],
): Set<T> {
  if (value === true) {
    return new Set(allFields);
  }
  if (Array.isArray(value)) {
    return new Set(value);
  }
  return new Set();
}

/**
 * Quick check: is any KV cache stability feature enabled?
 */
export function isKvCacheStabilityEnabled(resolved: ResolvedKvCacheStability): boolean {
  return resolved.perTurnFields.size > 0 || resolved.perChannelFields.size > 0;
}
