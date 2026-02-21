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

## Known limitation: persistent mode and memory flush

In `"persistent"` mode, compacted tool results are permanently replaced with placeholders in the session file. If the pre-compaction memory flush hasn't run yet, the original tool output is lost from the session. The model's assistant responses (which summarize tool output) are preserved and typically capture the key information, but some detail may be lost.

Users who need full tool output preservation should use `"disabled"` mode instead.
