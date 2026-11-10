import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { useTranslatorContext } from "@/contexts/TranslatorContext";
import type {
  ExternalTranslationConfigInput,
  TranslateRequest,
  TranslateResult,
  Translation,
  TranslatorProviderType,
} from "@/types";
import type {
  TranslationProvider,
  TranslationProviderTranslateOptions,
} from "@/external/providers/types";
import {
  resetLocalStorageMock,
  resetNavigatorLanguageMock,
  setupLocalStorageMock,
} from "@/__tests__/helpers/mocks";

type TranslateFn = jest.Mock<
  Promise<TranslateResult>,
  [TranslateRequest, TranslationProviderTranslateOptions | undefined]
>;

const translations: Translation[] = [
  { en: "Hello", pt: "Ola", es: "Hola" },
  { en: "Cat", pt: "Gato" },
  { pt: "So portugues" },
];

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
    }
  });
};

const customProvider = (
  translate: TranslateFn,
  extra: Partial<TranslationProvider> = {}
): TranslationProvider => ({ type: "custom", translate, ...extra });

const resolvingTranslate = (text = "Traduzido"): TranslateFn =>
  jest.fn().mockResolvedValue({ translatedText: text });

const renderProvider = (
  external: ExternalTranslationConfigInput | undefined,
  props: Partial<Omit<TranslatorProviderType, "children">> = {}
) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TranslatorProvider
      translations={translations}
      defaultLanguage="pt"
      externalTranslation={external}
      {...props}
    >
      {children}
    </TranslatorProvider>
  );
  return renderHook(() => useTranslatorContext(), { wrapper });
};

const enabled = (
  provider: TranslationProvider,
  extra: ExternalTranslationConfigInput = {}
): ExternalTranslationConfigInput => ({
  enabled: true,
  provider: { id: "custom", implementation: provider },
  ...extra,
});

const debugEvents = (spy: jest.SpyInstance) =>
  spy.mock.calls.map((call) => (call[1] as { event: string }).event);

describe("TranslatorProvider with a real manager and a faked provider", () => {
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    setupLocalStorageMock();
    resetLocalStorageMock();
    resetNavigatorLanguageMock();
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    debug = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("resolution flow", () => {
    it("shows the original text while pending and the translation once resolved", async () => {
      const translate = resolvingTranslate("Hello world");
      const { result } = renderProvider(enabled(customProvider(translate)));
      let first = "";
      act(() => {
        first = result.current.t("Unknown key");
      });
      expect(first).toBe("Unknown key");
      expect(result.current.isTranslating["Unknown key::pt"]).toBe(true);
      expect(result.current.isTranslatingAny).toBe(true);
      await settle();
      expect(result.current.isTranslating["Unknown key::pt"]).toBe(false);
      expect(result.current.isTranslatingAny).toBe(false);
      expect(result.current.t("Unknown key")).toBe("Hello world");
      expect(translate).toHaveBeenCalledTimes(1);
      expect(translate.mock.calls[0][0]).toEqual({
        text: "Unknown key",
        sourceLanguage: "auto",
        targetLanguage: "pt",
        glossary: undefined,
      });
    });

    it("uses the fallbackValue option while the translation is pending", async () => {
      const { result } = renderProvider(
        enabled(customProvider(resolvingTranslate()))
      );
      let value = "";
      act(() => {
        value = result.current.t("Unknown key", { fallbackValue: "Loading" });
      });
      expect(value).toBe("Loading");
      await settle();
    });

    it("derives the source text and language from the default language entry", async () => {
      const translate = resolvingTranslate("Hallo");
      const { result } = renderProvider(enabled(customProvider(translate)), {
        defaultLanguage: "en",
      });
      act(() => {
        result.current.setLanguage("es");
      });
      act(() => {
        result.current.t("Cat");
      });
      await settle();
      expect(translate.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          text: "Cat",
          sourceLanguage: "en",
          targetLanguage: "es",
        })
      );
    });

    it("honours an explicit sourceLanguage and its text", async () => {
      const translate = resolvingTranslate("Hallo");
      const { result } = renderProvider(enabled(customProvider(translate)), {
        defaultLanguage: "en",
      });
      act(() => {
        result.current.setLanguage("es");
      });
      act(() => {
        result.current.t("Cat", { sourceLanguage: "pt" });
      });
      await settle();
      expect(translate.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          text: "Gato",
          sourceLanguage: "pt",
          targetLanguage: "es",
        })
      );
    });

    it("falls back to the default language text when the explicit source has no text", async () => {
      const translate = resolvingTranslate("Hallo");
      const { result } = renderProvider(enabled(customProvider(translate)), {
        defaultLanguage: "en",
      });
      act(() => {
        result.current.setLanguage("es");
      });
      act(() => {
        result.current.t("Cat", { sourceLanguage: "zz" });
      });
      await settle();
      expect(translate.mock.calls[0][0]).toEqual(
        expect.objectContaining({ text: "Cat", sourceLanguage: "zz" })
      );
    });

    it("shows the first available entry value as fallback when the language is missing", async () => {
      const { result } = renderProvider(
        enabled(customProvider(resolvingTranslate())),
        { defaultLanguage: "en" }
      );
      act(() => {
        result.current.setLanguage("es");
      });
      let value = "";
      act(() => {
        value = result.current.t("So portugues");
      });
      expect(value).toBe("So portugues");
      await settle();
    });

    it("does not start the same translation twice while it is pending", async () => {
      const translate = resolvingTranslate();
      const { result } = renderProvider(enabled(customProvider(translate)));
      act(() => {
        result.current.t("Unknown key");
      });
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(translate).toHaveBeenCalledTimes(1);
    });

    it("forces external translation for preferExternal over a local entry", async () => {
      const translate = resolvingTranslate("Ola externo");
      const { result } = renderProvider(enabled(customProvider(translate)));
      act(() => {
        result.current.t("Hello", { preferExternal: true });
      });
      await settle();
      expect(result.current.t("Hello")).toBe("Ola externo");
    });

    it("forces external translation for keys declared in alwaysExternalKeys as an array", async () => {
      const translate = resolvingTranslate("Ola externo");
      const { result } = renderProvider(
        enabled(customProvider(translate), { alwaysExternalKeys: ["Hello"] })
      );
      act(() => {
        result.current.t("Hello");
      });
      await settle();
      expect(translate).toHaveBeenCalledTimes(1);
      expect(result.current.externalConfig.alwaysExternalKeys.has("Hello")).toBe(
        true
      );
    });

    it("accepts alwaysExternalKeys given as a Set and copies it", () => {
      const keys = new Set(["Hello"]);
      const { result } = renderProvider(
        enabled(customProvider(resolvingTranslate()), {
          alwaysExternalKeys: keys,
        })
      );
      expect(result.current.externalConfig.alwaysExternalKeys).not.toBe(keys);
      expect([...result.current.externalConfig.alwaysExternalKeys]).toEqual([
        "Hello",
      ]);
    });

    it("keeps registered keys when the external config changes", () => {
      const provider = customProvider(resolvingTranslate());
      const first = enabled(provider, { alwaysExternalKeys: ["a"] });
      const second = enabled(provider, { alwaysExternalKeys: ["b"] });
      let current = first;
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TranslatorProvider
          translations={translations}
          defaultLanguage="pt"
          externalTranslation={current}
        >
          {children}
        </TranslatorProvider>
      );
      const { result, rerender } = renderHook(() => useTranslatorContext(), {
        wrapper,
      });
      act(() => {
        result.current.registerExternalKey("runtime");
      });
      current = second;
      rerender();
      expect(
        result.current.externalConfig.alwaysExternalKeys.has("b")
      ).toBe(true);
      expect(
        result.current.externalConfig.alwaysExternalKeys.has("runtime")
      ).toBe(true);
    });

    it("keeps the same key set when a key is registered twice", () => {
      const { result } = renderProvider(
        enabled(customProvider(resolvingTranslate()))
      );
      act(() => {
        result.current.registerExternalKey("runtime");
      });
      const keys = result.current.externalConfig.alwaysExternalKeys;
      act(() => {
        result.current.registerExternalKey("runtime");
      });
      expect(result.current.externalConfig.alwaysExternalKeys).toBe(keys);
    });

    it("keeps returning the pending value when a local entry was forced external and then read normally", async () => {
      const translate: TranslateFn = jest
        .fn()
        .mockReturnValue(new Promise<TranslateResult>(() => {}));
      const { result } = renderProvider(enabled(customProvider(translate)));
      act(() => {
        result.current.t("Hello", { preferExternal: true, fallbackValue: "Wait" });
      });
      let plain = "";
      act(() => {
        plain = result.current.t("Hello");
      });
      expect(plain).toBe("Wait");
      await settle();
      expect(translate).toHaveBeenCalledTimes(1);
      expect(result.current.isTranslating["Hello::pt"]).toBe(true);
    });

    it("forwards the abort signal option to the provider", async () => {
      const translate: TranslateFn = jest.fn(
        (_request, options) =>
          new Promise<TranslateResult>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          })
      );
      const controller = new AbortController();
      const { result } = renderProvider(enabled(customProvider(translate)));
      act(() => {
        result.current.t("Unknown key", { signal: controller.signal });
      });
      await settle();
      expect(translate.mock.calls[0][1]?.signal?.aborted).toBe(false);
      controller.abort();
      await settle();
      expect(translate.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(result.current.isTranslating["Unknown key::pt"]).toBe(false);
    });
  });

  describe("failure handling", () => {
    it("falls back to the displayed text and stops loading when the provider fails", async () => {
      const onTranslationError = jest.fn();
      const translate: TranslateFn = jest
        .fn()
        .mockRejectedValue(new Error("provider down"));
      const { result } = renderProvider(
        enabled(customProvider(translate), { onTranslationError })
      );
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(result.current.isTranslating["Unknown key::pt"]).toBe(false);
      expect(result.current.t("Unknown key")).toBe("Unknown key");
      expect(onTranslationError).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "Unknown key",
          language: "pt",
          originalText: "Unknown key",
        })
      );
      expect(translate).toHaveBeenCalledTimes(1);
    });

    it("treats an empty translation as an error and retries only after the delay", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const translate: TranslateFn = jest
        .fn()
        .mockResolvedValueOnce({ translatedText: "" })
        .mockResolvedValueOnce({ translatedText: "Agora sim" });
      const { result } = renderProvider(enabled(customProvider(translate)));
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(translate).toHaveBeenCalledTimes(1);
      jest.setSystemTime(new Date("2026-01-01T00:00:31Z"));
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(translate).toHaveBeenCalledTimes(2);
      expect(result.current.t("Unknown key")).toBe("Agora sim");
      jest.useRealTimers();
    });

    it("treats a vetoed translation as an error state keeping the original text", async () => {
      const translate = resolvingTranslate();
      const { result } = renderProvider(
        enabled(customProvider(translate), { onExternalTranslation: () => false })
      );
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(translate).not.toHaveBeenCalled();
      expect(result.current.t("Unknown key")).toBe("Unknown key");
      expect(result.current.isTranslatingAny).toBe(false);
    });
  });

  describe("provider creation", () => {
    it("warns when the provider reports itself unavailable", () => {
      const provider = customProvider(resolvingTranslate(), {
        isAvailable: () => ({ available: false, reason: "no credentials" }),
      });
      renderProvider(enabled(provider));
      expect(debugEvents(warn)).toContain(
        "TranslatorProvider_provider_unavailable"
      );
      expect(warn).toHaveBeenCalledWith(
        "[vbss-translator]",
        expect.objectContaining({
          event: "TranslatorProvider_provider_unavailable",
          providerType: "custom",
          providerId: "custom",
          reason: "no credentials",
        })
      );
    });

    it("does not warn when the provider is available", () => {
      const provider = customProvider(resolvingTranslate(), {
        isAvailable: () => ({ available: true }),
      });
      renderProvider(enabled(provider));
      expect(debugEvents(warn)).not.toContain(
        "TranslatorProvider_provider_unavailable"
      );
    });

    it("warns and rethrows when the provider cannot be created", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      expect(() =>
        renderProvider({ enabled: true, provider: { id: "custom" } })
      ).toThrow(
        "Custom provider configuration must include either 'implementation' or 'factory'"
      );
      expect(warn).toHaveBeenCalledWith(
        "[vbss-translator]",
        expect.objectContaining({
          event: "TranslatorProvider_provider_creation_failed",
          providerId: "custom",
          error:
            "Custom provider configuration must include either 'implementation' or 'factory'",
        })
      );
      consoleError.mockRestore();
    });

    it("reports a non Error failure as Unknown error", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const factory = () => {
        throw "string failure";
      };
      expect(() =>
        renderProvider({
          enabled: true,
          provider: { id: "custom", factory },
        })
      ).toThrow();
      expect(warn).toHaveBeenCalledWith(
        "[vbss-translator]",
        expect.objectContaining({ error: "Unknown error" })
      );
      consoleError.mockRestore();
    });

    it("uses the cache only when it is enabled", async () => {
      const translate = resolvingTranslate("Cached");
      const { result } = renderProvider(
        enabled(customProvider(translate), {
          cache: { enabled: true, ttlMs: 1_000 },
        })
      );
      expect(result.current.externalConfig.cache).toEqual({
        enabled: true,
        ttlMs: 1_000,
      });
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(result.current.t("Unknown key")).toBe("Cached");
    });
  });

  describe("debug logging", () => {
    it("logs lifecycle and translation events when debug is on", async () => {
      const translate = resolvingTranslate("Hello world");
      const { result, unmount } = renderProvider(
        enabled(customProvider(translate, {
          isAvailable: () => ({ available: true }),
        }), { debug: true })
      );
      act(() => {
        result.current.t("Unknown key", { preferExternal: true });
      });
      await settle();
      result.current.t("Unknown key");
      unmount();
      const events = debugEvents(debug);
      expect(events).toEqual(
        expect.arrayContaining([
          "TranslatorProvider_provider_created",
          "TranslatorProvider_provider_available",
          "TranslatorProvider_mounted",
          "t_called",
          "setExternalStateEntry_called",
          "translation_promise_resolved",
          "translation_applying_resolved",
          "forceUpdate_triggered",
          "isTranslatingRecord_recalculated",
          "t_returning_resolved",
          "TranslatorProvider_unmounting",
        ])
      );
      expect(debug).toHaveBeenCalledWith(
        "[vbss-translator]",
        expect.objectContaining({
          event: "translation_applying_resolved",
          key: "Unknown key",
          targetLanguage: "pt",
          translatedText: "Hello world",
        })
      );
    });

    it("logs an invalid result when the provider returns empty text", async () => {
      const translate: TranslateFn = jest
        .fn()
        .mockResolvedValue({ translatedText: "" });
      const { result, unmount } = renderProvider(
        enabled(customProvider(translate), { debug: true })
      );
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(debugEvents(debug)).toContain("translation_invalid_result");
      unmount();
    });

    it("emits no debug logs when debug is off", async () => {
      const { result } = renderProvider(
        enabled(customProvider(resolvingTranslate()))
      );
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(debug).not.toHaveBeenCalled();
    });
  });

  describe("outside the test environment", () => {
    const original = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = original;
    });

    it("applies state updates through a transition", async () => {
      process.env.NODE_ENV = "development";
      const translate = resolvingTranslate("Via transition");
      const { result } = renderProvider(enabled(customProvider(translate)));
      act(() => {
        result.current.t("Unknown key");
      });
      await settle();
      expect(result.current.t("Unknown key")).toBe("Via transition");
    });
  });
});
