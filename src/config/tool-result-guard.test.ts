import { describe, expect, it } from "vitest";
import { resolveToolResultGuardMode } from "./tool-result-guard.js";
import type { OpenClawConfig } from "./types.openclaw.js";

function cfg(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return { ...overrides } as OpenClawConfig;
}

describe("resolveToolResultGuardMode", () => {
  it("returns 'default' when no config", () => {
    expect(resolveToolResultGuardMode({})).toBe("default");
    expect(resolveToolResultGuardMode({ cfg: undefined })).toBe("default");
  });

  it("returns 'default' when agents section is empty", () => {
    expect(resolveToolResultGuardMode({ cfg: cfg({ agents: {} }) })).toBe("default");
  });

  it("reads global default", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: { toolResultGuard: { mode: "disabled" } },
          },
        }),
      }),
    ).toBe("disabled");
  });

  it("reads per-model default", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: {
              toolResultGuard: { mode: "disabled" },
              models: {
                "ollama/llama": { toolResultGuard: { mode: "persistent" } },
              },
            },
          },
        }),
        modelKey: "ollama/llama",
      }),
    ).toBe("persistent");
  });

  it("per-model default does not match different model", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: {
              toolResultGuard: { mode: "disabled" },
              models: {
                "ollama/llama": { toolResultGuard: { mode: "persistent" } },
              },
            },
          },
        }),
        modelKey: "openai/gpt-4",
      }),
    ).toBe("disabled");
  });

  it("reads per-agent override", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: { toolResultGuard: { mode: "default" } },
            list: [{ id: "bot", toolResultGuard: { mode: "persistent" } }],
          },
        }),
        agentId: "bot",
      }),
    ).toBe("persistent");
  });

  it("reads per-agent + per-model override (highest priority)", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: { toolResultGuard: { mode: "default" } },
            list: [
              {
                id: "bot",
                toolResultGuard: { mode: "disabled" },
                models: {
                  "ollama/llama": { toolResultGuard: { mode: "persistent" } },
                },
              },
            ],
          },
        }),
        agentId: "bot",
        modelKey: "ollama/llama",
      }),
    ).toBe("persistent");
  });

  it("per-agent overrides global default", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: { toolResultGuard: { mode: "persistent" } },
            list: [{ id: "bot", toolResultGuard: { mode: "disabled" } }],
          },
        }),
        agentId: "bot",
      }),
    ).toBe("disabled");
  });

  it("falls through when agent has no override", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: { toolResultGuard: { mode: "persistent" } },
            list: [{ id: "other", toolResultGuard: { mode: "disabled" } }],
          },
        }),
        agentId: "bot",
      }),
    ).toBe("persistent");
  });

  it("returns 'default' when config has mode undefined", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: { toolResultGuard: {} },
          },
        }),
      }),
    ).toBe("default");
  });

  it("matches provider wildcard 'ollama/*'", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: {
              models: {
                "ollama/*": { toolResultGuard: { mode: "persistent" } },
              },
            },
          },
        }),
        modelKey: "ollama/glm-4.7-flash",
      }),
    ).toBe("persistent");
  });

  it("exact model key takes priority over provider wildcard", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: {
              models: {
                "ollama/*": { toolResultGuard: { mode: "persistent" } },
                "ollama/special": { toolResultGuard: { mode: "disabled" } },
              },
            },
          },
        }),
        modelKey: "ollama/special",
      }),
    ).toBe("disabled");
  });

  it("provider wildcard does not match different provider", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            defaults: {
              toolResultGuard: { mode: "default" },
              models: {
                "ollama/*": { toolResultGuard: { mode: "persistent" } },
              },
            },
          },
        }),
        modelKey: "openai/gpt-4",
      }),
    ).toBe("default");
  });

  it("provider wildcard works in per-agent models", () => {
    expect(
      resolveToolResultGuardMode({
        cfg: cfg({
          agents: {
            list: [
              {
                id: "bot",
                models: {
                  "local/*": { toolResultGuard: { mode: "disabled" } },
                },
              },
            ],
          },
        }),
        agentId: "bot",
        modelKey: "local/my-model",
      }),
    ).toBe("disabled");
  });
});
