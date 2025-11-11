import { render, renderHook, act } from "@testing-library/react";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { useTranslatorContext } from "@/contexts/TranslatorContext";
import type { TranslateOptions, TranslatorContextType } from "@/types";
import {
  mockTranslations,
  mockTranslationsWithEdgeCases,
  emptyTranslations,
} from "@/__tests__/helpers/fixtures";
import {
  resetLocalStorageMock,
  resetNavigatorLanguageMock,
  setupNavigatorLanguageMock,
  setupLocalStorageMock,
} from "@/__tests__/helpers/mocks";
import { localStorageMock } from "@/__tests__/helpers/mocks";

const externalManagerTranslateMock = jest.fn();
const externalManagerIsEnabledMock = jest.fn(() => true);

jest.mock("@/external/ExternalTranslationManager", () => ({
  ExternalTranslationManager: jest.fn().mockImplementation(() => ({
    translate: externalManagerTranslateMock,
    isEnabled: externalManagerIsEnabledMock,
  })),
}));

const { ExternalTranslationManager: ExternalTranslationManagerMock } =
  jest.requireMock("@/external/ExternalTranslationManager") as {
    ExternalTranslationManager: jest.Mock;
  };

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const createStateKey = (key: string, language: string) => `${key}::${language}`;

const ERROR_RETRY_DELAY_MS = 30_000;

const invokeTranslate = (
  result: { current: TranslatorContextType },
  key: string,
  options?: TranslateOptions
): string => {
  let value = "";
  act(() => {
    value = result.current.t(key, options);
  });
  return value;
};

describe("TranslatorProvider", () => {
  beforeEach(() => {
    setupLocalStorageMock();
    resetLocalStorageMock();
    resetNavigatorLanguageMock();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "debug").mockImplementation(() => {});
    ExternalTranslationManagerMock.mockClear();
    externalManagerTranslateMock.mockReset();
    externalManagerIsEnabledMock.mockReset();
    externalManagerIsEnabledMock.mockReturnValue(true);
    externalManagerTranslateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Core Functionality", () => {
    describe("Default Language Initialization", () => {
      it("should use defaultLanguage prop when no persistence or auto-detection", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="es"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("es");
      });

      it('should default to "en" when defaultLanguage not provided', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider translations={mockTranslations}>
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("en");
      });
    });

    describe("Translation Lookup", () => {
      describe("Found Translation", () => {
        it("should return exact match translation", () => {
          const wrapper = ({ children }: { children: React.ReactNode }) => (
            <TranslatorProvider
              translations={mockTranslations}
              defaultLanguage="en"
            >
              {children}
            </TranslatorProvider>
          );
          const { result } = renderHook(() => useTranslatorContext(), {
            wrapper,
          });
          expect(invokeTranslate(result, "Hello")).toBe("Hello");
          expect(invokeTranslate(result, "Goodbye")).toBe("Goodbye");
        });

        it("should return translation for current language", () => {
          const wrapper = ({ children }: { children: React.ReactNode }) => (
            <TranslatorProvider
              translations={mockTranslations}
              defaultLanguage="pt"
            >
              {children}
            </TranslatorProvider>
          );
          const { result } = renderHook(() => useTranslatorContext(), {
            wrapper,
          });
          expect(invokeTranslate(result, "Hello")).toBe("Olá");
          expect(invokeTranslate(result, "Goodbye")).toBe("Adeus");
        });
      });

      describe("Missing Translation", () => {
        it("should return input text and log warning when translation is missing", async () => {
          const consoleWarnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const wrapper = ({ children }: { children: React.ReactNode }) => (
            <TranslatorProvider
              translations={mockTranslations}
              defaultLanguage="en"
            >
              {children}
            </TranslatorProvider>
          );
          const { result } = renderHook(() => useTranslatorContext(), {
            wrapper,
          });
          const resultText = invokeTranslate(result, "NonExistentText");
          expect(resultText).toBe("NonExistentText");
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            "[vbss-translator]",
            expect.objectContaining({
              scope: "translator",
              event: "missing_translation",
              key: "NonExistentText",
              language: "en",
            })
          );
          expect(externalManagerTranslateMock).toHaveBeenCalledWith({
            key: "NonExistentText",
            text: "NonExistentText",
            targetLanguage: "en",
            sourceLanguage: undefined,
            signal: undefined,
          });
          await flushMicrotasks();
          consoleWarnSpy.mockRestore();
        });

        it("should return input text when translation exists but not for current language", async () => {
          const consoleWarnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const wrapper = ({ children }: { children: React.ReactNode }) => (
            <TranslatorProvider
              translations={mockTranslations}
              defaultLanguage="fr"
            >
              {children}
            </TranslatorProvider>
          );
          const { result } = renderHook(() => useTranslatorContext(), {
            wrapper,
          });
          const resultText = invokeTranslate(result, "Hello");
          expect(resultText).toBe("Hello");
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            "[vbss-translator]",
            expect.objectContaining({
              scope: "translator",
              event: "missing_translation",
              key: "Hello",
              language: "fr",
            })
          );
          expect(externalManagerTranslateMock).toHaveBeenCalledWith({
            key: "Hello",
            text: "Hello",
            targetLanguage: "fr",
            sourceLanguage: undefined,
            signal: undefined,
          });
          await flushMicrotasks();
          consoleWarnSpy.mockRestore();
        });
      });

      describe("Case-Insensitive Matching", () => {
        it("should match translations case-insensitively using toLocaleLowerCase", () => {
          const wrapper = ({ children }: { children: React.ReactNode }) => (
            <TranslatorProvider
              translations={mockTranslationsWithEdgeCases}
              defaultLanguage="en"
            >
              {children}
            </TranslatorProvider>
          );
          const { result } = renderHook(() => useTranslatorContext(), {
            wrapper,
          });
          expect(invokeTranslate(result, "hello")).toBe("Hello");
          expect(invokeTranslate(result, "HELLO")).toBe("Hello");
          expect(invokeTranslate(result, "Hello")).toBe("Hello");
        });

        it("should handle case-insensitive matching for different languages", () => {
          const wrapper = ({ children }: { children: React.ReactNode }) => (
            <TranslatorProvider
              translations={mockTranslationsWithEdgeCases}
              defaultLanguage="pt"
            >
              {children}
            </TranslatorProvider>
          );
          const { result } = renderHook(() => useTranslatorContext(), {
            wrapper,
          });
          expect(invokeTranslate(result, "hello")).toBe("Olá");
          expect(invokeTranslate(result, "HELLO")).toBe("Olá");
        });
      });
    });

    describe("Language Switching", () => {
      it("should update language when setLanguage is called", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("en");
        act(() => {
          result.current.setLanguage("pt");
        });
        expect(result.current.language).toBe("pt");
      });

      it("should update translation output after language change", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(invokeTranslate(result, "Hello")).toBe("Hello");
        act(() => {
          result.current.setLanguage("es");
        });
        expect(invokeTranslate(result, "Hello")).toBe("Hola");
      });
    });

    describe("Available Languages", () => {
      it("should derive available languages from first translation object keys", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.languages).toEqual(["en", "pt", "es"]);
      });

      it("should return empty array when translations array is empty", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={emptyTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.languages).toEqual([]);
      });

      it("should handle translations with different language sets", () => {
        const customTranslations = [{ en: "Test", fr: "Teste", de: "Testen" }];
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={customTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.languages).toEqual(["en", "fr", "de"]);
      });
    });
  });

  describe("External translation integration", () => {
    it("renders resolved external translation in consumer components", async () => {
      let resolveTranslation:
        | ((value: { translatedText: string }) => void)
        | undefined;
      externalManagerTranslateMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveTranslation = resolve;
          })
      );
      const textToTranslate =
        "Dynamic content fetched from an external service.";
      const DynamicComponent = () => {
        const { t } = useTranslatorContext();
        return (
          <div data-testid="dynamic">
            {t(textToTranslate, { preferExternal: true, sourceLanguage: "pt" })}
          </div>
        );
      };
      const { getByTestId } = render(
        <TranslatorProvider translations={emptyTranslations}>
          <DynamicComponent />
        </TranslatorProvider>
      );
      expect(getByTestId("dynamic").textContent).toBe(textToTranslate);
      await act(async () => {
        resolveTranslation?.({
          translatedText: "Contenido dinámico traducido.",
        });
        await Promise.resolve();
      });
      expect(getByTestId("dynamic").textContent).toBe(
        "Contenido dinámico traducido."
      );
    });
  });

  describe("External Translation Configuration", () => {
    it("should expose default external translation configuration when not provided", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider translations={mockTranslations}>
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.externalConfig.enabled).toBe(true);
      expect(result.current.externalConfig.timeoutMs).toBe(5_000);
      expect(result.current.externalConfig.provider).toEqual({ id: "google" });
      expect(result.current.externalConfig.cache).toEqual({
        enabled: false,
        ttlMs: 3_600_000,
      });
      expect(
        Array.from(result.current.externalConfig.alwaysExternalKeys)
      ).toEqual([]);
      expect(result.current.isTranslating).toEqual({});
      expect(result.current.isTranslatingAny).toBe(false);
    });

    it("should merge provided externalTranslation overrides and preserve defaults", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          externalTranslation={{
            enabled: false,
            timeoutMs: 10_000,
            debug: true,
            provider: {
              id: "google",
              apiKey: "test-key",
              endpoint: "https://example.com",
            },
            cache: { enabled: true, ttlMs: 1_000, maxEntries: 500 },
            alwaysExternalKeys: ["sku", "description"],
          }}
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.externalConfig.enabled).toBe(false);
      expect(result.current.externalConfig.timeoutMs).toBe(10_000);
      expect(result.current.externalConfig.debug).toBe(true);
      expect(result.current.externalConfig.provider).toEqual({
        id: "google",
        apiKey: "test-key",
        endpoint: "https://example.com",
      });
      expect(result.current.externalConfig.cache).toEqual({
        enabled: true,
        ttlMs: 1_000,
        maxEntries: 500,
      });
      expect(
        Array.from(result.current.externalConfig.alwaysExternalKeys).sort()
      ).toEqual(["description", "sku"]);
    });

    it("should register new external keys at runtime and keep existing ones", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          externalTranslation={{
            alwaysExternalKeys: new Set(["initial"]),
          }}
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      act(() => {
        result.current.registerExternalKey("dynamic");
      });
      expect(
        Array.from(result.current.externalConfig.alwaysExternalKeys).sort()
      ).toEqual(["dynamic", "initial"]);
    });
  });

  describe("External Translation Flow", () => {
    it("should resolve external translation for missing entries and update loading state", async () => {
      let resolveTranslation:
        | ((value: { translatedText: string }) => void)
        | undefined;
      externalManagerTranslateMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveTranslation = resolve;
          })
      );
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider translations={mockTranslations}>
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      act(() => {
        result.current.setLanguage("es");
      });
      let initialValue = "";
      act(() => {
        initialValue = invokeTranslate(result, "Dynamic Product");
      });
      expect(initialValue).toBe("Dynamic Product");
      expect(externalManagerTranslateMock).toHaveBeenCalledWith({
        key: "Dynamic Product",
        text: "Dynamic Product",
        targetLanguage: "es",
        sourceLanguage: undefined,
        signal: undefined,
      });
      await flushMicrotasks();
      const pendingKey = createStateKey("Dynamic Product", "es");
      expect(result.current.isTranslating[pendingKey]).toBe(true);
      expect(result.current.isTranslatingAny).toBe(true);
      await act(async () => {
        resolveTranslation?.({ translatedText: "Producto Dinámico" });
        await Promise.resolve();
      });
      expect(result.current.isTranslating[pendingKey]).toBe(false);
      expect(result.current.isTranslatingAny).toBe(false);
      expect(invokeTranslate(result, "Dynamic Product")).toBe(
        "Producto Dinámico"
      );
    });

    it("should honour preferExternal even when local translation exists", async () => {
      externalManagerTranslateMock.mockResolvedValue({
        translatedText: "Olá Externo",
      });
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider translations={mockTranslations}>
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      act(() => {
        result.current.setLanguage("pt");
      });
      let initialValue = "";
      act(() => {
        initialValue = invokeTranslate(result, "Hello", {
          preferExternal: true,
        });
      });
      expect(initialValue).toBe("Olá");
      expect(externalManagerTranslateMock).toHaveBeenCalledTimes(1);
      await flushMicrotasks();
      expect(invokeTranslate(result, "Hello")).toBe("Olá Externo");
    });

    it("should trigger external translation for alwaysExternalKeys", async () => {
      externalManagerTranslateMock.mockResolvedValue({
        translatedText: "Saída Externa",
      });
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          externalTranslation={{ alwaysExternalKeys: ["Hello"] }}
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      act(() => {
        result.current.setLanguage("pt");
      });
      act(() => {
        invokeTranslate(result, "Hello");
      });
      expect(externalManagerTranslateMock).toHaveBeenCalledTimes(1);
      await flushMicrotasks();
      expect(invokeTranslate(result, "Hello")).toBe("Saída Externa");
    });

    it("should skip external translation when manager is disabled", () => {
      externalManagerIsEnabledMock.mockReturnValue(false);
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider translations={mockTranslations}>
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      const value = invokeTranslate(result, "Unmapped");
      expect(value).toBe("Unmapped");
      expect(externalManagerTranslateMock).not.toHaveBeenCalled();
    });

    it("should throttle retries after external errors", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(0);
      externalManagerTranslateMock.mockResolvedValue(undefined);
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider translations={mockTranslations}>
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      act(() => {
        invokeTranslate(result, "RetryKey");
      });
      expect(externalManagerTranslateMock).toHaveBeenCalledTimes(1);
      await flushMicrotasks();
      act(() => {
        invokeTranslate(result, "RetryKey");
      });
      expect(externalManagerTranslateMock).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(ERROR_RETRY_DELAY_MS);
      act(() => {
        invokeTranslate(result, "RetryKey");
      });
      expect(externalManagerTranslateMock).toHaveBeenCalledTimes(2);
      await flushMicrotasks();
      jest.useRealTimers();
    });
  });

  describe("localStorage Persistence Integration", () => {
    describe("Read on Mount", () => {
      it("should read from localStorage on mount when persist=true", () => {
        localStorageMock.getItem.mockReturnValue("pt");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        renderHook(() => useTranslatorContext(), { wrapper });
        expect(localStorageMock.getItem).toHaveBeenCalledWith("language");
      });

      it("should use persisted language when available", () => {
        localStorageMock.getItem.mockReturnValue("es");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("es");
      });

      it("should not read from localStorage when persist=false", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={false}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        renderHook(() => useTranslatorContext(), { wrapper });
        expect(localStorageMock.getItem).not.toHaveBeenCalled();
      });
    });

    describe("Write on Language Change", () => {
      it("should write to localStorage when language changes and persist=true", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        act(() => {
          result.current.setLanguage("pt");
        });
        expect(localStorageMock.setItem).toHaveBeenCalledWith("language", "pt");
      });

      it("should not write to localStorage when persist=false", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={false}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        act(() => {
          result.current.setLanguage("pt");
        });

        expect(localStorageMock.setItem).not.toHaveBeenCalled();
      });

      it("should persist initial language on mount when persist=true", () => {
        resetNavigatorLanguageMock();
        localStorageMock.getItem.mockReturnValue(null);
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            autoDetectLanguage={false}
            defaultLanguage="fr"
          >
            {children}
          </TranslatorProvider>
        );
        renderHook(() => useTranslatorContext(), { wrapper });
        expect(localStorageMock.setItem).toHaveBeenCalledWith("language", "fr");
      });
    });

    describe("Custom PersistKey", () => {
      it("should use custom persistKey for reading", () => {
        localStorageMock.getItem.mockReturnValue("pt");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            persistKey="custom-language-key"
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        renderHook(() => useTranslatorContext(), { wrapper });
        expect(localStorageMock.getItem).toHaveBeenCalledWith(
          "custom-language-key"
        );
      });

      it("should use custom persistKey for writing", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            persistKey="my-custom-key"
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        act(() => {
          result.current.setLanguage("es");
        });
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          "my-custom-key",
          "es"
        );
      });

      it('should default to "language" when persistKey not provided', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        act(() => {
          result.current.setLanguage("pt");
        });
        expect(localStorageMock.setItem).toHaveBeenCalledWith("language", "pt");
      });
    });
  });

  describe("Browser Language Auto-Detection Integration", () => {
    describe("Language Parsing", () => {
      it("should parse navigator.language and extract first part (before hyphen)", () => {
        setupNavigatorLanguageMock("pt-BR");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("pt");
      });

      it("should handle language codes without hyphen", () => {
        setupNavigatorLanguageMock("es");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("es");
      });

      it("should handle language codes with multiple hyphens", () => {
        setupNavigatorLanguageMock("zh-Hans-CN");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("zh");
      });
    });

    describe("Fallback Behavior", () => {
      it("should fallback to defaultLanguage if navigator.language parsing fails", () => {
        Object.defineProperty(window.navigator, "language", {
          writable: true,
          value: undefined,
        });
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("en");
      });

      it("should fallback to defaultLanguage if navigator.language is empty string", () => {
        setupNavigatorLanguageMock("");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={true}
            defaultLanguage="pt"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("pt");
      });
    });

    describe("Auto-Detection Toggle", () => {
      it("should use auto-detected language when autoDetectLanguage=true", () => {
        setupNavigatorLanguageMock("es");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("es");
      });

      it("should not use auto-detected language when autoDetectLanguage=false", () => {
        setupNavigatorLanguageMock("pt");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={false}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("en");
      });

      it("should default to not auto-detecting when autoDetectLanguage not provided", () => {
        setupNavigatorLanguageMock("pt");

        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("en");
      });
    });

    describe("Precedence over defaultLanguage", () => {
      it("should use auto-detected language instead of defaultLanguage when both are available", () => {
        setupNavigatorLanguageMock("pt");
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            autoDetectLanguage={true}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.language).toBe("pt");
        expect(result.current.language).not.toBe("en");
      });
    });
  });

  describe("Combined Persistence + Auto-Detection Precedence", () => {
    it("should prioritize persisted language over auto-detected language", () => {
      localStorageMock.getItem.mockReturnValue("pt");
      setupNavigatorLanguageMock("es");
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          persist={true}
          autoDetectLanguage={true}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.language).toBe("pt");
      expect(result.current.language).not.toBe("es");
      expect(result.current.language).not.toBe("en");
    });

    it("should prioritize persisted language over defaultLanguage", () => {
      localStorageMock.getItem.mockReturnValue("es");
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          persist={true}
          autoDetectLanguage={false}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.language).toBe("es");
      expect(result.current.language).not.toBe("en");
    });

    it("should use auto-detected language when no persisted language exists", () => {
      localStorageMock.getItem.mockReturnValue(null);
      setupNavigatorLanguageMock("pt");
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          persist={true}
          autoDetectLanguage={true}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.language).toBe("pt");
      expect(result.current.language).not.toBe("en");
    });

    it("should fallback to defaultLanguage when neither persisted nor auto-detected available", () => {
      localStorageMock.getItem.mockReturnValue(null);
      resetNavigatorLanguageMock();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          persist={true}
          autoDetectLanguage={false}
          defaultLanguage="es"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.language).toBe("es");
    });

    it("should follow precedence: persisted > auto-detected > defaultLanguage", () => {
      localStorageMock.getItem.mockReturnValue("pt");
      setupNavigatorLanguageMock("es");
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          persist={true}
          autoDetectLanguage={true}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.language).toBe("pt");
    });

    it("should use auto-detected when persist is false but autoDetectLanguage is true", () => {
      setupNavigatorLanguageMock("pt");
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          persist={false}
          autoDetectLanguage={true}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslatorContext(), { wrapper });
      expect(result.current.language).toBe("pt");
      expect(result.current.language).not.toBe("en");
    });
  });

  describe("useEffect Dependencies", () => {
    describe("Persistence Effect Triggers", () => {
      it("should trigger persistence when language changes", () => {
        resetNavigatorLanguageMock();
        localStorageMock.getItem.mockReturnValue(null);
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            autoDetectLanguage={false}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        localStorageMock.setItem.mockClear();
        act(() => {
          result.current.setLanguage("pt");
        });
        expect(localStorageMock.setItem).toHaveBeenCalledWith("language", "pt");
      });

      it("should not persist when persist is false, even if language changes", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            persist={false}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        act(() => {
          result.current.setLanguage("pt");
        });
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
      });

      it("should persist initial language when persist changes from false to true", () => {
        const TestComponent = () => {
          const context = useTranslatorContext();
          return <div data-testid="language">{context.language}</div>;
        };
        const { rerender } = render(
          <TranslatorProvider
            translations={mockTranslations}
            persist={false}
            defaultLanguage="en"
          >
            <TestComponent />
          </TranslatorProvider>
        );
        localStorageMock.setItem.mockClear();
        rerender(
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            defaultLanguage="en"
          >
            <TestComponent />
          </TranslatorProvider>
        );
        expect(localStorageMock.setItem).toHaveBeenCalledWith("language", "en");
      });

      it("should update persistence key when persistKey changes", () => {
        resetNavigatorLanguageMock();
        localStorageMock.getItem.mockReturnValue(null);
        const TestComponent = () => {
          const context = useTranslatorContext();
          return <div data-testid="language">{context.language}</div>;
        };
        const { rerender } = render(
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            persistKey="language"
            autoDetectLanguage={false}
            defaultLanguage="en"
          >
            <TestComponent />
          </TranslatorProvider>
        );
        localStorageMock.setItem.mockClear();
        rerender(
          <TranslatorProvider
            translations={mockTranslations}
            persist={true}
            persistKey="custom-key"
            autoDetectLanguage={false}
            defaultLanguage="en"
          >
            <TestComponent />
          </TranslatorProvider>
        );
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          "custom-key",
          "en"
        );
      });
    });
  });

  describe("Edge Cases", () => {
    describe("Empty Translations Array", () => {
      it("should handle empty translations array gracefully", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={emptyTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.languages).toEqual([]);
        expect(result.current.language).toBe("en");
      });

      it("should return input text when translations array is empty", async () => {
        const consoleWarnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={emptyTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        const resultText = invokeTranslate(result, "Hello");
        expect(resultText).toBe("Hello");
        expect(consoleWarnSpy).toHaveBeenCalled();
        await flushMicrotasks();
        consoleWarnSpy.mockRestore();
      });
    });

    describe("Missing Translation Warnings", () => {
      it("should log warning for missing translations", async () => {
        const consoleWarnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        invokeTranslate(result, "NonExistentText");
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "[vbss-translator]",
          expect.objectContaining({
            scope: "translator",
            event: "missing_translation",
            key: "NonExistentText",
            language: "en",
          })
        );
        expect(externalManagerTranslateMock).toHaveBeenCalledWith({
          key: "NonExistentText",
          text: "NonExistentText",
          targetLanguage: "en",
          sourceLanguage: undefined,
          signal: undefined,
        });
        await flushMicrotasks();
        consoleWarnSpy.mockRestore();
      });

      it("should log warning for each missing translation call", async () => {
        const consoleWarnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        invokeTranslate(result, "Missing1");
        invokeTranslate(result, "Missing2");
        expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
        expect(externalManagerTranslateMock).toHaveBeenCalledTimes(2);
        await flushMicrotasks();
        consoleWarnSpy.mockRestore();
      });
    });

    describe("Case-Insensitive Matching", () => {
      it("should match translations regardless of case using toLocaleLowerCase", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslationsWithEdgeCases}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(invokeTranslate(result, "hello")).toBe("Hello");
        expect(invokeTranslate(result, "HELLO")).toBe("Hello");
        expect(invokeTranslate(result, "Hello")).toBe("Hello");
        expect(invokeTranslate(result, "HeLLo")).toBe("Hello");
      });

      it("should handle case-insensitive matching for different languages", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslationsWithEdgeCases}
            defaultLanguage="pt"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(invokeTranslate(result, "hello")).toBe("Olá");
        expect(invokeTranslate(result, "HELLO")).toBe("Olá");
        expect(invokeTranslate(result, "Hello")).toBe("Olá");
      });
    });

    describe("Invalid Language Switching", () => {
      it("should allow switching to any language string, even if not in available languages", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        expect(result.current.languages).toEqual(["en", "pt", "es"]);
        act(() => {
          result.current.setLanguage("fr");
        });
        expect(result.current.language).toBe("fr");
      });

      it("should return input text when switching to invalid language and translation is missing", async () => {
        const consoleWarnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        act(() => {
          result.current.setLanguage("fr");
        });
        const resultText = invokeTranslate(result, "Hello");
        expect(resultText).toBe("Hello");
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "[vbss-translator]",
          expect.objectContaining({
            scope: "translator",
            event: "missing_translation",
            key: "Hello",
            language: "fr",
          })
        );
        expect(externalManagerTranslateMock).toHaveBeenCalledWith({
          key: "Hello",
          text: "Hello",
          targetLanguage: "fr",
          sourceLanguage: "en",
          signal: undefined,
        });
        await flushMicrotasks();
        consoleWarnSpy.mockRestore();
      });

      it("should handle empty string as language", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider
            translations={mockTranslations}
            defaultLanguage="en"
          >
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
        act(() => {
          result.current.setLanguage("");
        });
        expect(result.current.language).toBe("");
      });
    });
  });
});
