import { ExternalTranslationManager } from "@/external/ExternalTranslationManager";
import { TranslationCache } from "@/external/cache/TranslationCache";
import type {
  ExternalTranslationConfig,
  TranslateRequest,
  TranslateResult,
} from "@/types";
import type {
  ExternalTranslationLogger,
  ExternalTranslationManagerRequest,
} from "@/external/types";
import type {
  TranslationProvider,
  TranslationProviderTranslateOptions,
} from "@/external/providers/types";

const result = (text: string): TranslateResult => ({ translatedText: text });

const request = (
  overrides: Partial<ExternalTranslationManagerRequest> = {}
): ExternalTranslationManagerRequest => ({
  key: "greeting",
  text: "Hello",
  targetLanguage: "es",
  ...overrides,
});

const config = (
  overrides: Partial<ExternalTranslationConfig> = {}
): ExternalTranslationConfig => ({
  enabled: true,
  provider: { id: "google" },
  cache: { enabled: true, ttlMs: 60_000 },
  alwaysExternalKeys: new Set<string>(),
  timeoutMs: 500,
  debug: false,
  ...overrides,
});

type TranslateMock = jest.Mock<
  Promise<TranslateResult>,
  [TranslateRequest, TranslationProviderTranslateOptions | undefined]
>;

const provider = (
  translate: TranslateMock,
  extra: Partial<TranslationProvider> = {}
): TranslationProvider => ({ type: "google", translate, ...extra });

const resolvingProvider = (text = "Hola") =>
  provider(jest.fn().mockResolvedValue(result(text)));

const logger = (withDebug = true) => ({
  warn: jest.fn(),
  ...(withDebug ? { debug: jest.fn() } : {}),
}) as jest.Mocked<ExternalTranslationLogger>;

const abortAware = (): TranslateMock =>
  jest.fn(
    (_request, options) =>
      new Promise<TranslateResult>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted by signal"))
        );
      })
  );

describe("ExternalTranslationManager behavior", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("reports whether external translation is enabled", () => {
    expect(
      new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ enabled: false }),
      }).isEnabled()
    ).toBe(false);
    expect(
      new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config(),
      }).isEnabled()
    ).toBe(true);
  });

  describe("request normalization", () => {
    it("sends source language auto and no glossary by default", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
      });
      await manager.translate(request());
      expect(translate).toHaveBeenCalledTimes(1);
      expect(translate.mock.calls[0][0]).toEqual({
        text: "Hello",
        sourceLanguage: "auto",
        targetLanguage: "es",
        glossary: undefined,
      });
    });

    it("forwards explicit source language and glossary to the provider", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
      });
      await manager.translate(
        request({ sourceLanguage: "en", glossary: { Hello: "Hola" } })
      );
      expect(translate.mock.calls[0][0]).toEqual({
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "es",
        glossary: { Hello: "Hola" },
      });
    });

    it("passes the default timeout to the provider", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 750 }),
      });
      await manager.translate(request());
      expect(translate.mock.calls[0][1]?.timeoutMs).toBe(750);
    });

    it("prefers a positive request timeout over the configured one", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 750 }),
      });
      await manager.translate(request({ timeoutMs: 120 }));
      expect(translate.mock.calls[0][1]?.timeoutMs).toBe(120);
    });

    it("ignores an invalid request timeout and uses the configured one", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 750 }),
      });
      await manager.translate(request({ timeoutMs: 0 }));
      expect(translate.mock.calls[0][1]?.timeoutMs).toBe(750);
    });

    it("passes no timeout and arms no timer when the effective timeout is not positive", async () => {
      jest.useFakeTimers();
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 0 }),
      });
      await manager.translate(request());
      expect(translate.mock.calls[0][1]?.timeoutMs).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("cache keys", () => {
    it("treats glossaries with the same entries in a different order as the same request", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
        cache: new TranslationCache({ enabled: true, ttlMs: 60_000 }),
      });
      await manager.translate(request({ glossary: { a: "1", b: "2" } }));
      await manager.translate(request({ glossary: { b: "2", a: "1" } }));
      expect(translate).toHaveBeenCalledTimes(1);
    });

    it("separates requests with different glossaries", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
        cache: new TranslationCache({ enabled: true, ttlMs: 60_000 }),
      });
      await manager.translate(request({ glossary: { a: "1" } }));
      await manager.translate(request({ glossary: { a: "2" } }));
      expect(translate).toHaveBeenCalledTimes(2);
    });

    it("ignores an empty glossary when hashing", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
        cache: new TranslationCache({ enabled: true, ttlMs: 60_000 }),
      });
      await manager.translate(request({ glossary: {} }));
      await manager.translate(request());
      expect(translate).toHaveBeenCalledTimes(1);
    });

    it("separates requests with different target languages", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
        cache: new TranslationCache({ enabled: true, ttlMs: 60_000 }),
      });
      await manager.translate(request({ targetLanguage: "es" }));
      await manager.translate(request({ targetLanguage: "pt" }));
      expect(translate).toHaveBeenCalledTimes(2);
    });

    it("translates every time when no cache is configured", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
      });
      await manager.translate(request());
      await manager.translate(request());
      expect(translate).toHaveBeenCalledTimes(2);
    });

    it("stores the successful result in the provided cache", async () => {
      const cache = new TranslationCache({ enabled: true, ttlMs: 60_000 });
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider("Hola"),
        config: config(),
        cache,
      });
      await manager.translate(request());
      expect(cache.entries().map((entry) => entry.result)).toEqual([
        result("Hola"),
      ]);
    });
  });

  describe("hooks", () => {
    it("falls back to translating when shouldTranslate throws and warns", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider("Hola"),
        config: config({
          shouldTranslate: () => {
            throw new Error("predicate broke");
          },
        }),
        logger: log,
      });
      await expect(manager.translate(request())).resolves.toEqual(result("Hola"));
      expect(log.warn).toHaveBeenCalledWith(
        "external_translation_should_translate_error",
        expect.objectContaining({
          scope: "translator",
          event: "external_translation_should_translate_error",
          key: "greeting",
          language: "es",
        })
      );
    });

    it("passes the normalized request to shouldTranslate", async () => {
      const shouldTranslate = jest.fn().mockReturnValue(true);
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ shouldTranslate }),
      });
      await manager.translate(request());
      expect(shouldTranslate).toHaveBeenCalledWith({
        key: "greeting",
        text: "Hello",
        targetLanguage: "es",
        sourceLanguage: "auto",
      });
    });

    it("translates when onExternalTranslation throws and warns", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider("Hola"),
        config: config({
          onExternalTranslation: () => {
            throw new Error("hook broke");
          },
        }),
        logger: log,
      });
      await expect(manager.translate(request())).resolves.toEqual(result("Hola"));
      expect(log.warn).toHaveBeenCalledWith(
        "external_translation_hook_error",
        expect.objectContaining({ key: "greeting", language: "es" })
      );
    });

    it("translates when onExternalTranslation rejects", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider("Hola"),
        config: config({
          onExternalTranslation: () => Promise.reject(new Error("async hook")),
        }),
        logger: log,
      });
      await expect(manager.translate(request())).resolves.toEqual(result("Hola"));
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it("translates when onExternalTranslation returns nothing", async () => {
      const onExternalTranslation = jest.fn();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider("Hola"),
        config: config({ onExternalTranslation }),
      });
      await expect(manager.translate(request())).resolves.toEqual(result("Hola"));
      expect(onExternalTranslation).toHaveBeenCalledWith({
        key: "greeting",
        text: "Hello",
        targetLanguage: "es",
        sourceLanguage: "auto",
      });
    });

    it("does not call the provider or cache when onExternalTranslation vetoes", async () => {
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const cache = new TranslationCache({ enabled: true, ttlMs: 60_000 });
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ onExternalTranslation: () => false }),
        cache,
      });
      await expect(manager.translate(request())).resolves.toBeUndefined();
      expect(translate).not.toHaveBeenCalled();
      expect(cache.size()).toBe(0);
    });

    it("warns but still returns the result when onTranslationComplete throws", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider("Hola"),
        config: config({
          onTranslationComplete: () => {
            throw new Error("complete broke");
          },
        }),
        logger: log,
      });
      await expect(manager.translate(request())).resolves.toEqual(result("Hola"));
      expect(log.warn).toHaveBeenCalledWith(
        "external_translation_complete_callback_error",
        expect.objectContaining({ provider: "google" })
      );
    });

    it("warns when onTranslationError throws and still resolves undefined", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: provider(jest.fn().mockRejectedValue(new Error("boom"))),
        config: config({
          onTranslationError: () => {
            throw new Error("error handler broke");
          },
        }),
        logger: log,
      });
      await expect(manager.translate(request())).resolves.toBeUndefined();
      const events = log.warn.mock.calls.map((call) => call[0]);
      expect(events).toEqual([
        "external_translation_error_callback_error",
        "external_fallback_failed",
      ]);
    });
  });

  describe("errors", () => {
    it("reports an Error thrown by the provider with its name and message", async () => {
      const onTranslationError = jest.fn();
      const failure = new TypeError("bad input");
      const manager = new ExternalTranslationManager({
        provider: provider(jest.fn().mockRejectedValue(failure)),
        config: config({ onTranslationError }),
        logger: logger(),
      });
      await expect(manager.translate(request())).resolves.toBeUndefined();
      expect(onTranslationError).toHaveBeenCalledWith({
        key: "greeting",
        language: "es",
        originalText: "Hello",
        error: {
          code: "TypeError",
          message: "bad input",
          retryable: false,
          details: failure,
        },
      });
    });

    it("uses unknown_error for an Error without a name", async () => {
      const onTranslationError = jest.fn();
      const failure = new Error("nameless");
      failure.name = "";
      const manager = new ExternalTranslationManager({
        provider: provider(jest.fn().mockRejectedValue(failure)),
        config: config({ onTranslationError }),
        logger: logger(),
      });
      await manager.translate(request());
      expect(onTranslationError.mock.calls[0][0].error.code).toBe(
        "unknown_error"
      );
    });

    it("reports a thrown non error value as unknown_error", async () => {
      const onTranslationError = jest.fn();
      const manager = new ExternalTranslationManager({
        provider: provider(jest.fn().mockRejectedValue("plain string")),
        config: config({ onTranslationError }),
        logger: logger(),
      });
      await manager.translate(request());
      expect(onTranslationError.mock.calls[0][0].error).toEqual({
        code: "unknown_error",
        message: "Unknown provider error",
        retryable: false,
        details: "plain string",
      });
    });

    it("logs the failure through the logger with provider and error code", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: provider(jest.fn().mockRejectedValue(new Error("boom"))),
        config: config(),
        logger: log,
      });
      await manager.translate(request());
      expect(log.warn).toHaveBeenCalledWith(
        "external_fallback_failed",
        expect.objectContaining({
          scope: "translator",
          provider: "google",
          key: "greeting",
          language: "es",
          errorCode: "Error",
          retryable: false,
          message: "boom",
        })
      );
    });

    it("falls back to console.warn when no logger is given", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const manager = new ExternalTranslationManager({
        provider: provider(jest.fn().mockRejectedValue(new Error("boom"))),
        config: config(),
      });
      await manager.translate(request());
      expect(warn).toHaveBeenCalledWith(
        "[vbss-translator]",
        expect.objectContaining({
          scope: "translator",
          event: "external_fallback_failed",
        })
      );
    });

    it("does not keep a failed request in flight", async () => {
      const translate: TranslateMock = jest
        .fn()
        .mockRejectedValueOnce(new Error("first fails"))
        .mockResolvedValueOnce(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config(),
        logger: logger(),
      });
      await expect(manager.translate(request())).resolves.toBeUndefined();
      await expect(manager.translate(request())).resolves.toEqual(result("Hola"));
      expect(translate).toHaveBeenCalledTimes(2);
    });

    it("uses the provider normalizeError when present", async () => {
      const onTranslationError = jest.fn();
      const normalizeError = jest.fn().mockReturnValue({
        code: "quota",
        message: "quota exceeded",
        retryable: true,
      });
      const failure = new Error("raw");
      const manager = new ExternalTranslationManager({
        provider: provider(jest.fn().mockRejectedValue(failure), {
          normalizeError,
        }),
        config: config({ onTranslationError }),
        logger: logger(),
      });
      await manager.translate(request());
      expect(normalizeError).toHaveBeenCalledWith(failure);
      expect(onTranslationError.mock.calls[0][0].error.code).toBe("quota");
    });
  });

  describe("timeouts and abort", () => {
    it("aborts the provider call and reports a retryable timeout", async () => {
      jest.useFakeTimers();
      const translate = abortAware();
      const onTranslationError = jest.fn();
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 200, onTranslationError }),
        logger: logger(),
      });
      const pending = manager.translate(request());
      await jest.advanceTimersByTimeAsync(200);
      await expect(pending).resolves.toBeUndefined();
      expect(translate.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(onTranslationError.mock.calls[0][0].error).toEqual(
        expect.objectContaining({
          code: "timeout",
          message: "External translation timed out after 200ms",
          retryable: true,
        })
      );
    });

    it("clears the timeout timer after a successful translation", async () => {
      jest.useFakeTimers();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ timeoutMs: 5_000 }),
      });
      await manager.translate(request());
      expect(jest.getTimerCount()).toBe(0);
    });

    it("propagates an already aborted external signal to the provider", async () => {
      const translate: TranslateMock = jest.fn((_request, options) =>
        Promise.reject(
          new Error(options?.signal?.aborted ? "already aborted" : "live")
        )
      );
      const onTranslationError = jest.fn();
      const controller = new AbortController();
      controller.abort();
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 0, onTranslationError }),
        logger: logger(),
      });
      await expect(
        manager.translate(request({ signal: controller.signal }))
      ).resolves.toBeUndefined();
      expect(translate.mock.calls[0][1]?.signal).not.toBe(controller.signal);
      expect(onTranslationError.mock.calls[0][0].error.message).toBe(
        "already aborted"
      );
    });

    it("aborts the provider call when the external signal aborts later", async () => {
      const translate = abortAware();
      const onTranslationError = jest.fn();
      const controller = new AbortController();
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 0, onTranslationError }),
        logger: logger(),
      });
      const outcome = manager.translate(request({ signal: controller.signal }));
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      await expect(outcome).resolves.toBeUndefined();
      expect(translate.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(onTranslationError.mock.calls[0][0].error.code).toBe("Error");
    });

    it("removes the abort listener from the external signal after completion", async () => {
      const controller = new AbortController();
      const add = jest.spyOn(controller.signal, "addEventListener");
      const remove = jest.spyOn(controller.signal, "removeEventListener");
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ timeoutMs: 0 }),
      });
      await manager.translate(request({ signal: controller.signal }));
      expect(add).toHaveBeenCalledWith("abort", expect.any(Function), {
        once: true,
      });
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    });

    it("calls the provider with the original signal when AbortController is unavailable", async () => {
      const original = global.AbortController;
      const external = new AbortController();
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 300 }),
      });
      Object.defineProperty(global, "AbortController", {
        configurable: true,
        writable: true,
        value: undefined,
      });
      try {
        await manager.translate(request({ signal: external.signal }));
      } finally {
        Object.defineProperty(global, "AbortController", {
          configurable: true,
          writable: true,
          value: original,
        });
      }
      expect(translate.mock.calls[0][1]).toEqual({
        timeoutMs: 300,
        signal: external.signal,
      });
    });

    it("omits timeoutMs when AbortController is unavailable and timeout is disabled", async () => {
      const original = global.AbortController;
      const translate: TranslateMock = jest.fn().mockResolvedValue(result("Hola"));
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ timeoutMs: 0 }),
      });
      Object.defineProperty(global, "AbortController", {
        configurable: true,
        writable: true,
        value: undefined,
      });
      try {
        await manager.translate(request());
      } finally {
        Object.defineProperty(global, "AbortController", {
          configurable: true,
          writable: true,
          value: original,
        });
      }
      expect(translate.mock.calls[0][1]).toEqual({
        timeoutMs: undefined,
        signal: undefined,
      });
    });
  });

  describe("debug logging", () => {
    const events = (log: jest.Mocked<ExternalTranslationLogger>) =>
      (log.debug as jest.Mock).mock.calls.map((call) => call[0]);

    it("emits no debug output when debug is off", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: false }),
        logger: log,
      });
      await manager.translate(request());
      expect(log.debug).not.toHaveBeenCalled();
    });

    it("logs start and success through logger.debug", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: true }),
        logger: log,
      });
      await manager.translate(request());
      expect(events(log)).toEqual([
        "external_translation_started",
        "external_translation_succeeded",
      ]);
      expect(log.debug).toHaveBeenCalledWith(
        "external_translation_started",
        expect.objectContaining({ scope: "translator", key: "greeting" })
      );
    });

    it("logs cache hits", async () => {
      const log = logger();
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: true }),
        cache: new TranslationCache({ enabled: true, ttlMs: 60_000 }),
        logger: log,
      });
      await manager.translate(request());
      await manager.translate(request());
      expect(events(log)).toContain("external_translation_cache_hit");
    });

    it("logs disabled, skipped and vetoed requests", async () => {
      const disabledLog = logger();
      await new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: true, enabled: false }),
        logger: disabledLog,
      }).translate(request());
      expect(events(disabledLog)).toEqual(["external_translation_disabled"]);

      const skippedLog = logger();
      await new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: true, shouldTranslate: () => false }),
        logger: skippedLog,
      }).translate(request());
      expect(events(skippedLog)).toEqual(["external_translation_skipped"]);

      const vetoedLog = logger();
      await new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: true, onExternalTranslation: () => false }),
        logger: vetoedLog,
      }).translate(request());
      expect(events(vetoedLog)).toEqual(["external_translation_vetoed"]);
    });

    it("logs deduplicated concurrent requests", async () => {
      const log = logger();
      let finish: (value: TranslateResult) => void = () => {};
      const translate: TranslateMock = jest.fn(
        () => new Promise<TranslateResult>((resolve) => (finish = resolve))
      );
      const manager = new ExternalTranslationManager({
        provider: provider(translate),
        config: config({ debug: true }),
        logger: log,
      });
      const first = manager.translate(request());
      const second = manager.translate(request());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      finish(result("Hola"));
      await expect(first).resolves.toEqual(result("Hola"));
      await expect(second).resolves.toEqual(result("Hola"));
      expect(translate).toHaveBeenCalledTimes(1);
      expect(events(log)).toContain("external_translation_deduped");
    });

    it("falls back to console.debug when the logger has no debug method", async () => {
      const debug = jest.spyOn(console, "debug").mockImplementation(() => {});
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: true }),
        logger: logger(false),
      });
      await manager.translate(request());
      expect(debug).toHaveBeenCalledWith(
        "[vbss-translator]",
        expect.objectContaining({ event: "external_translation_started" })
      );
    });

    it("falls back to console.debug when there is no logger", async () => {
      const debug = jest.spyOn(console, "debug").mockImplementation(() => {});
      const manager = new ExternalTranslationManager({
        provider: resolvingProvider(),
        config: config({ debug: true }),
      });
      await manager.translate(request());
      expect(debug).toHaveBeenCalledTimes(2);
    });
  });
});
