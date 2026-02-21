import type { ToolResultGuardMode } from "./types.agent-defaults.js";
import type { OpenClawConfig } from "./types.openclaw.js";

/**
 * Resolve the tool result guard mode for a given agent + model combination.
 *
 * Resolution order (most specific wins):
 * 1. agents.list[agentId].models[modelKey].toolResultGuard
 * 2. agents.list[agentId].toolResultGuard
 * 3. agents.defaults.models[modelKey].toolResultGuard
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
    // 1. Per-agent + per-model
    modelKey ? agentEntry?.models?.[modelKey]?.toolResultGuard : undefined,
    // 2. Per-agent
    agentEntry?.toolResultGuard,
    // 3. Per-model (global defaults)
    modelKey ? defaults?.models?.[modelKey]?.toolResultGuard : undefined,
    // 4. Global defaults
    defaults?.toolResultGuard,
  ];

  const effective = candidates.find((c) => c !== undefined);
  return effective?.mode ?? "default";
}
