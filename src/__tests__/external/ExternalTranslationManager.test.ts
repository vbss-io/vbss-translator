import { ExternalTranslationManager } from "@/external/ExternalTranslationManager";
import { TranslationCache } from "@/external/cache/TranslationCache";
import type {
  ExternalTranslationConfig,
  ProviderError,
  TranslateResult,
} from "@/types";
import type {
  ExternalTranslationManagerDependencies,
  ExternalTranslationManagerRequest,
} from "@/external/types";
import type { TranslationProvider } from "@/external/providers/types";

const createResult = (text: string): TranslateResult => ({
  translatedText: text,
});

const createRequest = (
  overrides: Partial<ExternalTranslationManagerRequest> = {}
): ExternalTranslationManagerRequest => ({
  key: "greeting",
  text: "Hello",
  targetLanguage: "es",
  ...overrides,
});

const createConfig = (
  overrides: Partial<ExternalTranslationConfig> = {}
): ExternalTranslationConfig => ({
  enabled: overrides.enabled ?? true,
  provider: {
    id: "google",
    ...(overrides.provider ?? {}),
  },
  cache: {
    enabled: overrides.cache?.enabled ?? true,
    ttlMs: overrides.cache?.ttlMs ?? 5_000,
    maxEntries: overrides.cache?.maxEntries,
  },
  alwaysExternalKeys: overrides.alwaysExternalKeys ?? new Set<string>(),
  timeoutMs: overrides.timeoutMs ?? 500,
  debug: overrides.debug ?? false,
  shouldTranslate: overrides.shouldTranslate,
  onExternalTranslation: overrides.onExternalTranslation,
  onTranslationComplete: overrides.onTranslationComplete,
  onTranslationError: overrides.onTranslationError,
});

const createManager = (
  overrides: Partial<ExternalTranslationManagerDependencies> = {}
) => {
  const config = overrides.config ?? createConfig();
  const cache =
    overrides.cache ??
    new TranslationCache({
      enabled: config.cache.enabled,
      ttlMs: config.cache.ttlMs,
      maxEntries: config.cache.maxEntries,
    });
  const provider =
    overrides.provider ??
    ({
      type: "google",
      translate: jest
        .fn()
        .mockResolvedValue(
          createResult("Hola")
        ) as TranslationProvider["translate"],
      normalizeError: jest.fn((error: unknown): ProviderError => {
        if (error instanceof Error) {
          return {
            code: error.name || "error",
            message: error.message,
            retryable: false,
            details: error,
          };
        }
        return {
          code: "error",
          message: "Unknown error",
          retryable: false,
          details: error,
        };
      }),
    } satisfies TranslationProvider);
  const logger =
    overrides.logger ??
    ({
      warn: jest.fn(),
      debug: jest.fn(),
    } as const);
  return new ExternalTranslationManager({
    provider,
    config,
    cache,
    logger,
  });
};

describe("ExternalTranslationManager", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns undefined when external translation is disabled", async () => {
    const provider = {
      type: "google",
      translate: jest.fn().mockResolvedValue(createResult("Hola")),
    } as TranslationProvider;
    const manager = createManager({
      provider,
      config: createConfig({ enabled: false }),
    });
    const result = await manager.translate(createRequest());
    expect(result).toBeUndefined();
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it("returns cached translations on subsequent calls", async () => {
    const provider = {
      type: "google",
      translate: jest.fn().mockResolvedValue(createResult("Hola")),
    } as TranslationProvider;
    const manager = createManager({ provider });
    const request = createRequest();
    const first = await manager.translate(request);
    const second = await manager.translate(request);
    expect(first?.translatedText).toBe("Hola");
    expect(second?.translatedText).toBe("Hola");
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent translations for the same key", async () => {
    jest.useFakeTimers();
    const provider = {
      type: "google",
      translate: jest.fn().mockImplementation(
        () =>
          new Promise<TranslateResult>((resolve) => {
            setTimeout(() => {
              resolve(createResult("Hola"));
            }, 50);
          })
      ),
    } as TranslationProvider;
    const manager = createManager({ provider });
    const request = createRequest();
    const firstPromise = manager.translate(request);
    const secondPromise = manager.translate(request);
    await jest.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    await expect(firstPromise).resolves.toEqual(createResult("Hola"));
    await expect(secondPromise).resolves.toEqual(createResult("Hola"));
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("honours shouldTranslate returning false", async () => {
    const provider = {
      type: "google",
      translate: jest.fn().mockResolvedValue(createResult("Hola")),
    } as TranslationProvider;
    const shouldTranslate = jest.fn(() => false);
    const manager = createManager({
      provider,
      config: createConfig({ shouldTranslate }),
    });
    const result = await manager.translate(createRequest());
    expect(result).toBeUndefined();
    expect(shouldTranslate).toHaveBeenCalledWith({
      key: "greeting",
      text: "Hello",
      targetLanguage: "es",
      sourceLanguage: "auto",
    });
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it("honours onExternalTranslation veto when callback returns false", async () => {
    const provider = {
      type: "google",
      translate: jest.fn().mockResolvedValue(createResult("Hola")),
    } as TranslationProvider;
    const onExternalTranslation = jest.fn().mockResolvedValue(false);
    const manager = createManager({
      provider,
      config: createConfig({ onExternalTranslation }),
    });
    const result = await manager.translate(createRequest());
    expect(result).toBeUndefined();
    expect(onExternalTranslation).toHaveBeenCalled();
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it("invokes onTranslationComplete after successful translation", async () => {
    const onTranslationComplete = jest.fn();
    const provider = {
      type: "google",
      translate: jest.fn().mockResolvedValue(createResult("Hola")),
    } as TranslationProvider;
    const manager = createManager({
      provider,
      config: createConfig({ onTranslationComplete }),
    });
    const result = await manager.translate(createRequest());
    expect(result?.translatedText).toBe("Hola");
    expect(onTranslationComplete).toHaveBeenCalledWith(result);
  });

  it("notifies onTranslationError when provider fails", async () => {
    const providerError: ProviderError = {
      code: "429",
      message: "quota exceeded",
      retryable: true,
      details: { status: 429 },
    };
    const provider = {
      type: "google",
      translate: jest.fn().mockRejectedValue(new Error("quota exceeded")),
      normalizeError: jest.fn(() => providerError),
    } as unknown as TranslationProvider;
    const onTranslationError = jest.fn();
    const manager = createManager({
      provider,
      config: createConfig({ onTranslationError }),
    });
    const result = await manager.translate(createRequest());
    expect(result).toBeUndefined();
    expect(onTranslationError).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "greeting",
        language: "es",
        error: providerError,
      })
    );
  });

  it("handles request timeout and reports error", async () => {
    jest.useFakeTimers();
    const provider = {
      type: "google",
      translate: jest.fn().mockImplementation(
        (_request, options) =>
          new Promise<TranslateResult>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          })
      ),
    } as TranslationProvider;
    const onTranslationError = jest.fn();
    const manager = createManager({
      provider,
      config: createConfig({
        timeoutMs: 100,
        onTranslationError,
      }),
    });
    const promise = manager.translate(createRequest());
    await jest.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result).toBeUndefined();
    expect(onTranslationError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "timeout",
          retryable: true,
        }),
      })
    );
  });
});
