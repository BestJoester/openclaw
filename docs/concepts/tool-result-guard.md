---
summary: "Configure tool result context guard behavior for KV cache stability"
read_when:
  - Experiencing KV cache oscillation on local LLM backends
  - Context token count fluctuates between turns despite same conversation
  - Configuring toolResultGuard in agents config
title: "Tool Result Guard"
---

# Tool Result Guard

The tool result context guard prevents context overflow by replacing older tool results with placeholders when the estimated context approaches the model's context window limit. By default these replacements are **in-memory only** — original tool results are preserved in the session file and reloaded on each run.

## The problem

On local LLM backends (llama.cpp, vLLM, etc.) that use prefix-based KV caching, in-memory-only compaction causes **cache oscillation**: when context hovers near the budget boundary, consecutive turns may alternate between compacted and non-compacted prompts. Each alternation invalidates the KV cache from the first changed tool result onward, forcing re-evaluation of tens of thousands of tokens (~100s per cache miss observed).

## Configuration

The `toolResultGuard` config has three modes:

| Mode           | Behavior                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `"default"`    | Current behavior: in-memory compaction, may cause KV cache oscillation                                                                        |
| `"disabled"`   | No automatic tool result compaction. Use if your backend handles context limits.                                                              |
| `"persistent"` | Compaction is written to the session file. Eliminates oscillation at the cost of permanently removing compacted tool output from the session. |

### Config hierarchy

Most specific wins. For a given agent + model combination:

1. `agents.list[id].models["provider/model"].toolResultGuard` (per-agent + per-model)
2. `agents.list[id].toolResultGuard` (per-agent)
3. `agents.defaults.models["provider/model"].toolResultGuard` (per-model)
4. `agents.defaults.toolResultGuard` (global)
5. Not set: `"default"`

### Examples

Global default for all agents:

```yaml
agents:
  defaults:
    toolResultGuard:
      mode: "persistent"
```

Per-model (local models get persistent, cloud stays default):

```yaml
agents:
  defaults:
    toolResultGuard:
      mode: "default"
    models:
      "ollama/glm-4.7-flash":
        toolResultGuard:
          mode: "persistent"
```

Per-agent + per-model:

```yaml
agents:
  list:
    - id: main
      models:
        "ollama/glm-4.7-flash":
          toolResultGuard:
            mode: "persistent"
```

## Compaction target

By default, when compaction fires (at 75% context utilization), the guard frees _just enough_ space to get back under budget. With multiple large tool results, this causes back-to-back compaction triggers: each new turn crosses the threshold again, compacts one more result, and invalidates the KV cache each time.

The `compactionTarget` parameter controls the **target utilization after compaction fires**. The trigger stays at 75%, but once triggered, the guard compacts down to the target ratio, creating headroom so subsequent turns don't immediately re-trigger.

```yaml
agents:
  defaults:
    toolResultGuard:
      mode: "persistent"
      compactionTarget: 0.50 # compact down to 50% when triggered
```

| `compactionTarget`     | Trigger at | Compacts down to | Headroom created |
| ---------------------- | ---------- | ---------------- | ---------------- |
| Not set (default 0.75) | 75%        | ~75%             | ~0%              |
| `0.60`                 | 75%        | ~60%             | ~15% of window   |
| `0.50`                 | 75%        | ~50%             | ~25% of window   |
| `0.40`                 | 75%        | ~40%             | ~35% of window   |

Lower values free more space per compaction event, reducing the frequency of cache invalidations at the cost of compacting more tool results sooner. If there aren't enough tool results to reach the target, the guard compacts all available tool results and stops.

The `compactionTarget` follows the same config hierarchy as `mode` — it can be set globally, per-model, per-agent, or per-agent+per-model.

## Provider wildcards

Model keys support provider-level wildcards like `"ollama/*"` to match any model under that provider. Exact model keys always take priority over wildcards.

```yaml
agents:
  defaults:
    models:
      "ollama/*":
        toolResultGuard:
          mode: "persistent"
      "ollama/special":
        toolResultGuard:
          mode: "disabled" # takes priority over ollama/* for this model
```

Note: Provider wildcards only apply to `toolResultGuard` resolution. Other model-level settings (streaming, alias, params, etc.) still require exact model keys.

## Known limitation: persistent mode and memory flush

In `"persistent"` mode, compacted tool results are permanently replaced with placeholders in the session file. If the pre-compaction memory flush hasn't run yet, the original tool output is lost from the session. The model's assistant responses (which summarize tool output) are preserved and typically capture the key information, but some detail may be lost.

Users who need full tool output preservation should use `"disabled"` mode instead.
