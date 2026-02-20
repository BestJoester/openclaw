import { resolveChannelCapabilities } from "../config/channel-capabilities.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { listBindings } from "../routing/bindings.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveSignalReactionLevel } from "../signal/reaction-level.js";
import { resolveTelegramInlineButtonsScope } from "../telegram/inline-buttons.js";
import { resolveTelegramReactionLevel } from "../telegram/reaction-level.js";
import type { ChannelContextForPrompt } from "./system-prompt.js";

/**
 * Build per-channel context data for all channels bound to an agent.
 * Used by kvCacheStability.perChannelFields to render static system prompt sections.
 */
export function buildAllChannelContexts(params: {
  cfg: OpenClawConfig;
  agentId: string;
  /** Global ownerAllowFrom (commands.ownerAllowFrom). Used as fallback. */
  globalOwnerNumbers?: string[];
}): ChannelContextForPrompt[] {
  const { cfg, agentId } = params;
  const normalizedId = normalizeAgentId(agentId);

  // Find all channels bound to this agent
  const bindings = listBindings(cfg);
  const channelAccountPairs = new Map<string, Set<string>>();
  for (const binding of bindings) {
    if (normalizeAgentId(binding.agentId) !== normalizedId) {
      continue;
    }
    const channel = binding.match.channel;
    if (!channelAccountPairs.has(channel)) {
      channelAccountPairs.set(channel, new Set());
    }
    if (binding.match.accountId) {
      channelAccountPairs.get(channel)!.add(binding.match.accountId);
    }
  }

  // If no bindings found, check for webchat (always available, no explicit binding needed)
  // and use the current channel config as fallback
  if (channelAccountPairs.size === 0) {
    return [];
  }

  const contexts: ChannelContextForPrompt[] = [];

  for (const [channel, accountIds] of channelAccountPairs) {
    // Use first account for resolution (most setups have one account per channel)
    const accountId = accountIds.size > 0 ? [...accountIds][0] : undefined;
    const displayName = capitalizeChannel(channel);

    // Resolve capabilities
    const capabilities = resolveChannelCapabilities({ cfg, channel, accountId }) ?? [];

    // Resolve reaction guidance
    let reactionGuidance: ChannelContextForPrompt["reactionGuidance"] | undefined;
    if (channel === "telegram") {
      const resolved = resolveTelegramReactionLevel({ cfg, accountId });
      if (resolved.agentReactionGuidance) {
        reactionGuidance = { level: resolved.agentReactionGuidance };
      }
    } else if (channel === "signal") {
      const resolved = resolveSignalReactionLevel({ cfg, accountId });
      if (resolved.agentReactionGuidance) {
        reactionGuidance = { level: resolved.agentReactionGuidance };
      }
    }

    // Resolve inline buttons (currently only Telegram)
    let inlineButtonsEnabled = capabilities.some((cap) => cap.toLowerCase() === "inlinebuttons");
    if (channel === "telegram" && !inlineButtonsEnabled) {
      const scope = resolveTelegramInlineButtonsScope({ cfg, accountId });
      if (scope !== "off") {
        inlineButtonsEnabled = true;
      }
    }

    // Resolve owner numbers — use global commands.ownerAllowFrom as baseline
    // Per-channel owner resolution requires dock infrastructure and is channel-specific.
    // For the static prompt, the global owner list is usually sufficient.
    const ownerNumbers = params.globalOwnerNumbers;

    contexts.push({
      channel: displayName,
      ownerNumbers,
      reactionGuidance,
      inlineButtonsEnabled,
      capabilities,
    });
  }

  // Always add webchat if not already present (webchat has no binding but is always available)
  const hasWebchat = contexts.some((c) => c.channel.toLowerCase() === "webchat");
  if (!hasWebchat) {
    contexts.push({
      channel: "Webchat",
      ownerNumbers: undefined,
      reactionGuidance: undefined,
      inlineButtonsEnabled: false,
      capabilities: [],
    });
  }

  return contexts;
}

function capitalizeChannel(channel: string): string {
  if (!channel) {
    return channel;
  }
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}
