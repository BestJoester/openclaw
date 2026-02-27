import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { applyExtraParamsToAgent } from "./extra-params.js";

// Mock streamSimple for testing
vi.mock("@mariozechner/pi-ai", () => ({
  streamSimple: vi.fn(() => ({
    push: vi.fn(),
    result: vi.fn(),
  })),
}));

type CustomParamsCase = {
  applyProvider: string;
  applyModelId: string;
  model: Model<"openai-completions">;
  cfg?: Parameters<typeof applyExtraParamsToAgent>[1];
  options?: SimpleStreamOptions;
};

function runCustomParamsCase(params: CustomParamsCase) {
  const payload: Record<string, unknown> = { model: params.model.id, messages: [], stream: true };
  const baseStreamFn: StreamFn = (_model, _context, options) => {
    options?.onPayload?.(payload);
    return {} as ReturnType<StreamFn>;
  };
  const agent = { streamFn: baseStreamFn };

  applyExtraParamsToAgent(agent, params.cfg, params.applyProvider, params.applyModelId);

  const context: Context = { messages: [] };
  void agent.streamFn?.(params.model, context, params.options ?? {});

  return payload;
}

const localModel = {
  api: "openai-completions" as const,
  provider: "local",
  id: "my-local-model",
} as Model<"openai-completions">;

describe("extra-params: custom sampling parameters", () => {
  it("injects custom params into the request payload", () => {
    const payload = runCustomParamsCase({
      applyProvider: "local",
      applyModelId: "my-local-model",
      model: localModel,
      cfg: {
        agents: {
          defaults: {
            models: {
              "local/my-local-model": {
                params: {
                  top_p: 0.9,
                  top_k: 40,
                  min_p: 0.05,
                },
              },
            },
          },
        },
      },
    });

    expect(payload.top_p).toBe(0.9);
    expect(payload.top_k).toBe(40);
    expect(payload.min_p).toBe(0.05);
  });

  it("does not forward handled params as custom params", () => {
    const payload = runCustomParamsCase({
      applyProvider: "local",
      applyModelId: "my-local-model",
      model: localModel,
      cfg: {
        agents: {
          defaults: {
            models: {
              "local/my-local-model": {
                params: {
                  temperature: 0.7,
                  maxTokens: 4096,
                  transport: "sse",
                  cacheRetention: "short",
                  cacheControlTtl: "5m",
                  anthropicBeta: "some-beta",
                  context1m: true,
                  tool_stream: true,
                  provider: { order: ["Fireworks"] },
                  // This one IS custom and should be forwarded
                  repeat_penalty: 1.1,
                },
              },
            },
          },
        },
      },
    });

    // Handled params should not appear as extra payload keys
    // (temperature/maxTokens go through streamParams, others through dedicated wrappers)
    expect(payload).not.toHaveProperty("cacheRetention");
    expect(payload).not.toHaveProperty("cacheControlTtl");
    expect(payload).not.toHaveProperty("anthropicBeta");
    expect(payload).not.toHaveProperty("context1m");
    // Custom param should be present
    expect(payload.repeat_penalty).toBe(1.1);
  });

  it("does not create a wrapper when no custom params exist", () => {
    const payload = runCustomParamsCase({
      applyProvider: "local",
      applyModelId: "my-local-model",
      model: localModel,
      cfg: {
        agents: {
          defaults: {
            models: {
              "local/my-local-model": {
                params: {
                  temperature: 0.5,
                  maxTokens: 2048,
                },
              },
            },
          },
        },
      },
    });

    // Only the base payload keys should exist
    expect(Object.keys(payload)).toEqual(["model", "messages", "stream"]);
  });

  it("injects multiple llama.cpp sampling params", () => {
    const payload = runCustomParamsCase({
      applyProvider: "local",
      applyModelId: "my-local-model",
      model: localModel,
      cfg: {
        agents: {
          defaults: {
            models: {
              "local/my-local-model": {
                params: {
                  top_p: 0.95,
                  top_k: 50,
                  min_p: 0.1,
                  typical_p: 0.9,
                  repeat_penalty: 1.15,
                  repeat_last_n: 64,
                  mirostat: 2,
                  mirostat_lr: 0.1,
                  mirostat_ent: 5.0,
                  frequency_penalty: 0.5,
                  presence_penalty: 0.3,
                  seed: 42,
                  dry_multiplier: 0.8,
                },
              },
            },
          },
        },
      },
    });

    expect(payload.top_p).toBe(0.95);
    expect(payload.top_k).toBe(50);
    expect(payload.min_p).toBe(0.1);
    expect(payload.typical_p).toBe(0.9);
    expect(payload.repeat_penalty).toBe(1.15);
    expect(payload.repeat_last_n).toBe(64);
    expect(payload.mirostat).toBe(2);
    expect(payload.mirostat_lr).toBe(0.1);
    expect(payload.mirostat_ent).toBe(5.0);
    expect(payload.frequency_penalty).toBe(0.5);
    expect(payload.presence_penalty).toBe(0.3);
    expect(payload.seed).toBe(42);
    expect(payload.dry_multiplier).toBe(0.8);
  });

  it("does not clobber core payload fields", () => {
    const payload = runCustomParamsCase({
      applyProvider: "local",
      applyModelId: "my-local-model",
      model: localModel,
      cfg: {
        agents: {
          defaults: {
            models: {
              "local/my-local-model": {
                params: {
                  top_k: 40,
                  seed: 123,
                },
              },
            },
          },
        },
      },
    });

    // Core fields from the base payload should be preserved
    expect(payload.model).toBe("my-local-model");
    expect(payload.messages).toEqual([]);
    expect(payload.stream).toBe(true);
    // Custom params should be injected
    expect(payload.top_k).toBe(40);
    expect(payload.seed).toBe(123);
  });
});
