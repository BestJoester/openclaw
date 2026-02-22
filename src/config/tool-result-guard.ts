import type {
  AgentModelEntryConfig,
  ToolResultGuardConfig,
  ToolResultGuardMode,
} from "./types.agent-defaults.js";
import type { OpenClawConfig } from "./types.openclaw.js";

export type ResolvedToolResultGuardConfig = {
  mode: ToolResultGuardMode;
  compactionTarget: number | undefined;
};

/**
 * Look up toolResultGuard from a models map, trying exact key first,
 * then a provider wildcard ("provider/*").
 */
function lookupModelGuard(
  models: Record<string, AgentModelEntryConfig> | undefined,
  modelKey: string | undefined,
): ToolResultGuardConfig | undefined {
  if (!models || !modelKey) {
    return undefined;
  }
  // Exact match first
  const exact = models[modelKey]?.toolResultGuard;
  if (exact !== undefined) {
    return exact;
  }
  // Provider wildcard: "ollama/*" matches "ollama/llama", "ollama/glm-4.7-flash", etc.
  const slash = modelKey.indexOf("/");
  if (slash > 0) {
    const wildcard = `${modelKey.slice(0, slash)}/*`;
    return models[wildcard]?.toolResultGuard;
  }
  return undefined;
}

/**
 * Resolve the full tool result guard config for a given agent + model combination.
 *
 * Resolution order (most specific wins, checked independently per field):
 * 1. agents.list[agentId].models[modelKey].toolResultGuard  (exact, then provider/*)
 * 2. agents.list[agentId].toolResultGuard
 * 3. agents.defaults.models[modelKey].toolResultGuard  (exact, then provider/*)
 * 4. agents.defaults.toolResultGuard
 * 5. Not set: mode="default", compactionTarget=undefined
 */
export function resolveToolResultGuardConfig(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
  modelKey?: string;
}): ResolvedToolResultGuardConfig {
  const { cfg, agentId, modelKey } = params;
  if (!cfg?.agents) {
    return { mode: "default", compactionTarget: undefined };
  }

  const defaults = cfg.agents.defaults;
  const agentEntry = agentId ? cfg.agents.list?.find((a) => a.id === agentId) : undefined;

  const candidates = [
    // 1. Per-agent + per-model (exact then wildcard)
    lookupModelGuard(agentEntry?.models, modelKey),
    // 2. Per-agent
    agentEntry?.toolResultGuard,
    // 3. Per-model global defaults (exact then wildcard)
    lookupModelGuard(defaults?.models, modelKey),
    // 4. Global defaults
    defaults?.toolResultGuard,
  ];

  const effective = candidates.find((c) => c !== undefined);
  const compactionTargetCandidate = candidates.find((c) => c?.compactionTarget !== undefined);

  return {
    mode: effective?.mode ?? "default",
    compactionTarget: compactionTargetCandidate?.compactionTarget,
  };
}

/**
 * Resolve the tool result guard mode for a given agent + model combination.
 *
 * @see resolveToolResultGuardConfig for full config resolution.
 */
export function resolveToolResultGuardMode(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
  modelKey?: string;
}): ToolResultGuardMode {
  return resolveToolResultGuardConfig(params).mode;
}
