import { ExternalTranslationManager } from "@/external/ExternalTranslationManager";
import { TranslationCache } from "@/external/cache/TranslationCache";
import { createTranslationProvider } from "@/external/providers/factory";
import type {
  ExternalTranslationConfig,
  ProviderError,
  TranslateResult,
  TranslateRequest,
} from "@/types";
import type { TranslationProvider } from "@/external/providers/types";
import type {
  ExternalTranslationManagerDependencies,
  ExternalTranslationManagerRequest,
} from "@/external/types";

class MockCustomProvider implements TranslationProvider {
  readonly type = "custom" as const;
  private readonly translationMap: Map<string, string>;
  private readonly callLog: TranslateRequest[] = [];
  private shouldFail = false;
  private availabilityStatus = true;

  constructor(translations: Record<string, string> = {}) {
    this.translationMap = new Map(Object.entries(translations));
  }

  async translate(
    request: TranslateRequest
  ): Promise<TranslateResult> {
    this.callLog.push(request);

    if (this.shouldFail) {
      throw new Error("Mock provider intentional failure");
    }

    const key = `${request.text}:${request.targetLanguage}`;
    const translatedText = this.translationMap.get(key) ?? `Translated: ${request.text}`;

    return {
      translatedText,
      detectedSourceLanguage: request.sourceLanguage === "auto" ? "en" : undefined,
      providerMetadata: {
        mockProvider: "true",
        requestCount: String(this.callLog.length),
      },
    };
  }

  isAvailable() {
    return {
      available: this.availabilityStatus,
      reason: this.availabilityStatus ? undefined : "Mock provider unavailable",
    };
  }

  normalizeError(error: unknown): ProviderError {
    if (error instanceof Error) {
      return {
        code: "mock_error",
        message: error.message,
        retryable: error.message.includes("timeout") || error.message.includes("aborted"),
        details: { originalError: error },
      };
    }
    return {
      code: "unknown",
      message: "Unknown error",
      retryable: false,
      details: error,
    };
  }

  getCallLog(): readonly TranslateRequest[] {
    return [...this.callLog];
  }

  clearCallLog(): void {
    this.callLog.length = 0;
  }

  setFailureMode(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  setAvailability(available: boolean): void {
    this.availabilityStatus = available;
  }

  addTranslation(text: string, targetLanguage: string, translation: string): void {
    this.translationMap.set(`${text}:${targetLanguage}`, translation);
  }
}

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
    id: "custom",
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
  provider: TranslationProvider,
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

describe("Custom Provider Integration", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Factory creation", () => {
    it("creates custom provider from implementation", () => {
      const mockProvider = new MockCustomProvider();
      const provider = createTranslationProvider({
        id: "custom",
        implementation: mockProvider,
      });
      expect(provider).toBe(mockProvider);
      expect(provider.type).toBe("custom");
    });

    it("creates custom provider from factory function", () => {
      const mockProvider = new MockCustomProvider();
      const factory = jest.fn(() => mockProvider);
      const provider = createTranslationProvider({
        id: "custom",
        factory,
      });
      expect(factory).toHaveBeenCalledTimes(1);
      expect(provider).toBe(mockProvider);
    });
  });

  describe("End-to-end translation workflow", () => {
    it("performs complete translation with custom provider", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
        "Goodbye:es": "Adiós",
      });
      const manager = createManager(mockProvider);
      const result1 = await manager.translate(createRequest({ text: "Hello" }));
      const result2 = await manager.translate(createRequest({ text: "Goodbye" }));
      expect(result1?.translatedText).toBe("Hola");
      expect(result2?.translatedText).toBe("Adiós");
      expect(mockProvider.getCallLog()).toHaveLength(2);
    });

    it("uses cache for repeated requests", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const manager = createManager(mockProvider);
      const result1 = await manager.translate(createRequest());
      const result2 = await manager.translate(createRequest());
      const result3 = await manager.translate(createRequest());
      expect(result1?.translatedText).toBe("Hola");
      expect(result2?.translatedText).toBe("Hola");
      expect(result3?.translatedText).toBe("Hola");
      expect(mockProvider.getCallLog()).toHaveLength(1);
    });

    it("respects cache TTL and refetches after expiration", async () => {
      jest.useFakeTimers();
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const manager = createManager(mockProvider, {
        config: createConfig({
          cache: {
            enabled: true,
            ttlMs: 1000,
          },
        }),
      });

      const result1 = await manager.translate(createRequest());
      expect(result1?.translatedText).toBe("Hola");
      expect(mockProvider.getCallLog()).toHaveLength(1);
      jest.advanceTimersByTime(1500);
      const result2 = await manager.translate(createRequest());
      expect(result2?.translatedText).toBe("Hola");
      expect(mockProvider.getCallLog()).toHaveLength(2);
    });
  });

  describe("Lifecycle hooks integration", () => {
    it("invokes all lifecycle hooks in correct order", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const hookCallOrder: string[] = [];
      const shouldTranslate = jest.fn(() => {
        hookCallOrder.push("shouldTranslate");
        return true;
      });
      const onExternalTranslation = jest.fn().mockImplementation(() => {
        hookCallOrder.push("onExternalTranslation");
        return true;
      });
      const onTranslationComplete = jest.fn(() => {
        hookCallOrder.push("onTranslationComplete");
      });
      const manager = createManager(mockProvider, {
        config: createConfig({
          shouldTranslate,
          onExternalTranslation,
          onTranslationComplete,
        }),
      });
      const result = await manager.translate(createRequest());
      expect(result?.translatedText).toBe("Hola");
      expect(hookCallOrder).toEqual([
        "shouldTranslate",
        "onExternalTranslation",
        "onTranslationComplete",
      ]);
    });

    it("stops execution when shouldTranslate returns false", async () => {
      const mockProvider = new MockCustomProvider();
      const shouldTranslate = jest.fn(() => false);
      const onExternalTranslation = jest.fn();
      const manager = createManager(mockProvider, {
        config: createConfig({
          shouldTranslate,
          onExternalTranslation,
        }),
      });
      const result = await manager.translate(createRequest());
      expect(result).toBeUndefined();
      expect(shouldTranslate).toHaveBeenCalled();
      expect(onExternalTranslation).not.toHaveBeenCalled();
      expect(mockProvider.getCallLog()).toHaveLength(0);
    });

    it("stops execution when onExternalTranslation returns false", async () => {
      const mockProvider = new MockCustomProvider();
      const onExternalTranslation = jest.fn().mockResolvedValue(false);
      const onTranslationComplete = jest.fn();

      const manager = createManager(mockProvider, {
        config: createConfig({
          onExternalTranslation,
          onTranslationComplete,
        }),
      });
      const result = await manager.translate(createRequest());
      expect(result).toBeUndefined();
      expect(onExternalTranslation).toHaveBeenCalled();
      expect(onTranslationComplete).not.toHaveBeenCalled();
      expect(mockProvider.getCallLog()).toHaveLength(0);
    });
  });

  describe("Error handling", () => {
    it("handles custom provider errors with normalizeError", async () => {
      const mockProvider = new MockCustomProvider();
      mockProvider.setFailureMode(true);
      const onTranslationError = jest.fn();
      const manager = createManager(mockProvider, {
        config: createConfig({ onTranslationError }),
      });
      const result = await manager.translate(createRequest());
      expect(result).toBeUndefined();
      expect(onTranslationError).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "greeting",
          language: "es",
          error: expect.objectContaining({
            code: "mock_error",
            message: "Mock provider intentional failure",
            retryable: false,
          }),
        })
      );
    });

    it("handles provider unavailability gracefully", async () => {
      const mockProvider = new MockCustomProvider();
      mockProvider.setAvailability(false);
      mockProvider.translate = jest.fn().mockImplementation(async () => {
        const availability = mockProvider.isAvailable();
        if (!availability.available) {
          throw new Error(`Provider unavailable: ${availability.reason}`);
        }
        return {
          translatedText: "Should not reach here",
        };
      });
      const onTranslationError = jest.fn();
      const manager = createManager(mockProvider, {
        config: createConfig({ onTranslationError }),
      });
      const result = await manager.translate(createRequest());
      expect(result).toBeUndefined();
      expect(onTranslationError).toHaveBeenCalled();
    });

    it("handles timeout with AbortSignal", async () => {
      jest.useFakeTimers();
      const mockProvider = new MockCustomProvider();
      const originalTranslate = mockProvider.translate.bind(mockProvider);
      mockProvider.translate = jest.fn().mockImplementation(
        async (request, options) => {
          return new Promise<TranslateResult>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new Error("Request timeout"));
            });
            setTimeout(() => {
              originalTranslate(request);
            }, 200);
          });
        }
      );
      const onTranslationError = jest.fn();
      const manager = createManager(mockProvider, {
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
            code: expect.stringMatching(/timeout|mock_error/),
          }),
        })
      );
    });
  });

  describe("Concurrency and deduplication", () => {
    it("deduplicates multiple concurrent requests", async () => {
      jest.useFakeTimers();
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const originalTranslate = mockProvider.translate.bind(mockProvider);
      mockProvider.translate = jest.fn().mockImplementation(
        async (request) => {
          return new Promise<TranslateResult>((resolve) => {
            setTimeout(async () => {
              const result = await originalTranslate(request);
              resolve(result);
            }, 50);
          });
        }
      );
      const manager = createManager(mockProvider);
      const request = createRequest();
      const promise1 = manager.translate(request);
      const promise2 = manager.translate(request);
      const promise3 = manager.translate(request);
      await jest.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
      expect(result1?.translatedText).toBe("Hola");
      expect(result2?.translatedText).toBe("Hola");
      expect(result3?.translatedText).toBe("Hola");
      expect(mockProvider.translate).toHaveBeenCalledTimes(1);
    });

    it("handles different requests concurrently without deduplication", async () => {
      jest.useFakeTimers();
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
        "Goodbye:es": "Adiós",
      });
      const originalTranslate = mockProvider.translate.bind(mockProvider);
      mockProvider.translate = jest.fn().mockImplementation(
        async (request) => {
          return new Promise<TranslateResult>((resolve) => {
            setTimeout(async () => {
              const result = await originalTranslate(request);
              resolve(result);
            }, 50);
          });
        }
      );
      const manager = createManager(mockProvider);
      const promise1 = manager.translate(createRequest({ text: "Hello" }));
      const promise2 = manager.translate(createRequest({ text: "Goodbye" }));
      await jest.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1?.translatedText).toBe("Hola");
      expect(result2?.translatedText).toBe("Adiós");
      expect(mockProvider.translate).toHaveBeenCalledTimes(2);
    });
  });

  describe("Provider metadata", () => {
    it("includes provider metadata in response", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const manager = createManager(mockProvider);
      const result = await manager.translate(createRequest());
      expect(result?.providerMetadata).toEqual({
        mockProvider: "true",
        requestCount: "1",
      });
    });

    it("preserves metadata through cache", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const manager = createManager(mockProvider);
      const result1 = await manager.translate(createRequest());
      const result2 = await manager.translate(createRequest());
      expect(result1?.providerMetadata).toEqual(result2?.providerMetadata);
      expect(mockProvider.getCallLog()).toHaveLength(1);
    });
  });

  describe("Source language detection", () => {
    it("includes detected source language when auto-detect is used", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const manager = createManager(mockProvider);
      const result = await manager.translate(
        createRequest({ sourceLanguage: "auto" })
      );
      expect(result?.detectedSourceLanguage).toBe("en");
    });

    it("omits detected source language when explicitly specified", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const manager = createManager(mockProvider);
      const result = await manager.translate(
        createRequest({ sourceLanguage: "en" })
      );
      expect(result?.detectedSourceLanguage).toBeUndefined();
    });
  });

  describe("Cache configuration", () => {
    it("bypasses cache when disabled", async () => {
      const mockProvider = new MockCustomProvider({
        "Hello:es": "Hola",
      });
      const manager = createManager(mockProvider, {
        config: createConfig({
          cache: {
            enabled: false,
            ttlMs: 5000,
          },
        }),
      });
      await manager.translate(createRequest());
      await manager.translate(createRequest());
      await manager.translate(createRequest());
      expect(mockProvider.getCallLog()).toHaveLength(3);
    });

    it("respects maxEntries cache limit", async () => {
      jest.useFakeTimers();
      const mockProvider = new MockCustomProvider();
      mockProvider.addTranslation("Text1", "es", "Texto1");
      mockProvider.addTranslation("Text2", "es", "Texto2");
      mockProvider.addTranslation("Text3", "es", "Texto3");
      const manager = createManager(mockProvider, {
        config: createConfig({
          cache: {
            enabled: true,
            ttlMs: 10000,
            maxEntries: 2,
          },
        }),
      });
      await manager.translate(createRequest({ key: "key1", text: "Text1" }));
      await manager.translate(createRequest({ key: "key2", text: "Text2" }));
      await manager.translate(createRequest({ key: "key3", text: "Text3" }));
      mockProvider.clearCallLog();
      await manager.translate(createRequest({ key: "key1", text: "Text1" }));
      await manager.translate(createRequest({ key: "key2", text: "Text2" }));
      await manager.translate(createRequest({ key: "key3", text: "Text3" }));
      expect(mockProvider.getCallLog().length).toBeGreaterThan(0);
    });
  });
});
