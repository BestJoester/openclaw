import type {
  AgentModelEntryConfig,
  ToolResultGuardConfig,
  ToolResultGuardMode,
} from "./types.agent-defaults.js";
import type { OpenClawConfig } from "./types.openclaw.js";

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
 * Resolve the tool result guard mode for a given agent + model combination.
 *
 * Resolution order (most specific wins):
 * 1. agents.list[agentId].models[modelKey].toolResultGuard  (exact, then provider/*)
 * 2. agents.list[agentId].toolResultGuard
 * 3. agents.defaults.models[modelKey].toolResultGuard  (exact, then provider/*)
 * 4. agents.defaults.toolResultGuard
 * 5. Not set: returns "default"
 */
export function resolveToolResultGuardMode(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
  modelKey?: string;
}): ToolResultGuardMode {
  const { cfg, agentId, modelKey } = params;
  if (!cfg?.agents) {
    return "default";
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
  return effective?.mode ?? "default";
}
