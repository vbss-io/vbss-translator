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
  provider: overrides.provider ?? {
    id: "google",
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

  describe("Custom provider integration", () => {
    it("uses custom provider for translation requests", async () => {
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockResolvedValue(createResult("Custom translation")),
      };
      const manager = createManager({ provider: customProvider });
      const result = await manager.translate(createRequest());
      expect(result?.translatedText).toBe("Custom translation");
      expect(customProvider.translate).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Hello",
          targetLanguage: "es",
          sourceLanguage: "auto",
        }),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          timeoutMs: 500,
        })
      );
    });

    it("caches custom provider translations", async () => {
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockResolvedValue(createResult("Custom translation")),
      };
      const manager = createManager({ provider: customProvider });
      const request = createRequest();
      const first = await manager.translate(request);
      const second = await manager.translate(request);
      expect(first?.translatedText).toBe("Custom translation");
      expect(second?.translatedText).toBe("Custom translation");
      expect(customProvider.translate).toHaveBeenCalledTimes(1);
    });

    it("uses custom provider normalizeError when available", async () => {
      const customError: ProviderError = {
        code: "custom_error",
        message: "Custom provider error",
        retryable: true,
        details: { customField: "value" },
      };
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockRejectedValue(new Error("Custom provider error")),
        normalizeError: jest.fn(() => customError),
      };
      const onTranslationError = jest.fn();
      const manager = createManager({
        provider: customProvider,
        config: createConfig({ onTranslationError }),
      });
      const result = await manager.translate(createRequest());
      expect(result).toBeUndefined();
      expect(customProvider.normalizeError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Custom provider error" })
      );
      expect(onTranslationError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: customError,
        })
      );
    });

    it("falls back to default error normalization when custom provider lacks normalizeError", async () => {
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockRejectedValue(new Error("Custom provider error")),
      };
      const onTranslationError = jest.fn();
      const manager = createManager({
        provider: customProvider,
        config: createConfig({ onTranslationError }),
      });
      const result = await manager.translate(createRequest());
      expect(result).toBeUndefined();
      expect(onTranslationError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "Error",
            message: "Custom provider error",
            retryable: false,
          }),
        })
      );
    });

    it("accepts custom provider with isAvailable method", async () => {
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockResolvedValue(createResult("Custom translation")),
        isAvailable: jest.fn(() => ({
          available: true,
        })),
      };
      const manager = createManager({ provider: customProvider });
      const result = await manager.translate(createRequest());
      expect(result?.translatedText).toBe("Custom translation");
      expect(customProvider.translate).toHaveBeenCalled();
    });

    it("invokes lifecycle hooks with custom provider", async () => {
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockResolvedValue(createResult("Custom translation")),
      };
      const shouldTranslate = jest.fn(() => true);
      const onExternalTranslation = jest.fn().mockResolvedValue(true);
      const onTranslationComplete = jest.fn();
      const manager = createManager({
        provider: customProvider,
        config: createConfig({
          shouldTranslate,
          onExternalTranslation,
          onTranslationComplete,
        }),
      });
      const result = await manager.translate(createRequest());
      expect(result?.translatedText).toBe("Custom translation");
      expect(shouldTranslate).toHaveBeenCalled();
      expect(onExternalTranslation).toHaveBeenCalled();
      expect(onTranslationComplete).toHaveBeenCalledWith(result);
    });

    it("deduplicates concurrent custom provider requests", async () => {
      jest.useFakeTimers();
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockImplementation(
          () =>
            new Promise<TranslateResult>((resolve) => {
              setTimeout(() => {
                resolve(createResult("Custom translation"));
              }, 50);
            })
        ),
      };
      const manager = createManager({ provider: customProvider });
      const request = createRequest();
      const firstPromise = manager.translate(request);
      const secondPromise = manager.translate(request);
      await jest.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await expect(firstPromise).resolves.toEqual(createResult("Custom translation"));
      await expect(secondPromise).resolves.toEqual(createResult("Custom translation"));
      expect(customProvider.translate).toHaveBeenCalledTimes(1);
    });

    it("handles custom provider timeout with AbortSignal", async () => {
      jest.useFakeTimers();
      const customProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn().mockImplementation(
          (_request, options) =>
            new Promise<TranslateResult>((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () => {
                reject(new Error("aborted"));
              });
            })
        ),
      };
      const onTranslationError = jest.fn();
      const manager = createManager({
        provider: customProvider,
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
          key: "greeting",
          language: "es",
          error: expect.objectContaining({
            retryable: expect.any(Boolean),
          }),
        })
      );
    });
  });
});
