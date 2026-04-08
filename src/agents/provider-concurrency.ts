import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../config/config.js";

/**
 * Async semaphore that limits concurrent access to a shared resource.
 * When all permits are taken, callers wait until a permit is released.
 */
export class AsyncSemaphore {
  private permits: number;
  private readonly waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits += 1;
    }
  }

  get available(): number {
    return this.permits;
  }

  get pending(): number {
    return this.waiting.length;
  }
}

// Process-global registry: shared across parent agents, subagents, cron jobs,
// and media understanding within the same gateway process.
const providerSemaphores = new Map<string, AsyncSemaphore>();

function getProviderSemaphore(providerId: string, maxConcurrency: number): AsyncSemaphore {
  let semaphore = providerSemaphores.get(providerId);
  if (!semaphore) {
    semaphore = new AsyncSemaphore(maxConcurrency);
    providerSemaphores.set(providerId, semaphore);
  }
  return semaphore;
}

/** Read maxConcurrency from provider config. Returns undefined when unlimited. */
export function resolveProviderMaxConcurrency(
  providerId: string,
  cfg?: OpenClawConfig,
): number | undefined {
  const providerCfg = cfg?.models?.providers?.[providerId];
  const value = (providerCfg as Record<string, unknown> | undefined)?.maxConcurrency;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * Acquire a provider slot. Returns a release function.
 * If the provider has no maxConcurrency, returns immediately with a no-op release.
 */
export async function acquireProviderSlot(
  providerId: string,
  cfg?: OpenClawConfig,
): Promise<() => void> {
  const maxConcurrency = resolveProviderMaxConcurrency(providerId, cfg);
  if (maxConcurrency == null) {
    return () => {};
  }
  const semaphore = getProviderSemaphore(providerId, maxConcurrency);
  await semaphore.acquire();
  let released = false;
  return () => {
    if (!released) {
      released = true;
      semaphore.release();
    }
  };
}

/**
 * Wrap a StreamFn with provider concurrency limiting.
 * Acquires a semaphore slot before streaming and releases it when the
 * stream is fully consumed (return/throw) or if the initial call fails.
 */
export function wrapStreamFnWithConcurrency(
  streamFn: StreamFn,
  providerId: string,
  cfg?: OpenClawConfig,
): StreamFn {
  const maxConcurrency = resolveProviderMaxConcurrency(providerId, cfg);
  if (maxConcurrency == null) {
    return streamFn;
  }
  const semaphore = getProviderSemaphore(providerId, maxConcurrency);

  const wrapped: StreamFn = async (model, context, options) => {
    await semaphore.acquire();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        semaphore.release();
      }
    };

    let stream: ReturnType<StreamFn> extends Promise<infer R> ? R : ReturnType<StreamFn>;
    try {
      const result = streamFn(model, context, options);
      stream = result instanceof Promise ? await result : result;
    } catch (err) {
      release();
      throw err;
    }

    // Wrap the async iterator so the semaphore is released when
    // iteration completes, whether by normal return or error.
    const originalIterator = stream[Symbol.asyncIterator]();
    const wrappedStream = Object.create(stream) as typeof stream;

    wrappedStream[Symbol.asyncIterator] = () => ({
      async next() {
        try {
          const result = await originalIterator.next();
          if (result.done) {
            release();
          }
          return result;
        } catch (err) {
          release();
          throw err;
        }
      },
      async return(value?: unknown) {
        release();
        return (
          originalIterator.return?.(value as AssistantMessageEvent) ?? {
            done: true as const,
            value: value as AssistantMessageEvent,
          }
        );
      },
      async throw(err?: unknown) {
        release();
        if (originalIterator.throw) {
          return originalIterator.throw(err);
        }
        throw err;
      },
    });

    return wrappedStream;
  };

  return wrapped;
}

/** Reset all semaphores — for testing only. */
export function clearProviderSemaphoresForTests(): void {
  providerSemaphores.clear();
}
