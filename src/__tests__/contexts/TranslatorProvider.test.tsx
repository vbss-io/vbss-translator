import { render, renderHook, act } from "@testing-library/react";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { useTranslatorContext } from "@/contexts/TranslatorContext";
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

describe("TranslatorProvider", () => {
  beforeEach(() => {
    setupLocalStorageMock();
    resetLocalStorageMock();
    resetNavigatorLanguageMock();
    jest.spyOn(console, "warn").mockImplementation(() => {});
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
          expect(result.current.t("Hello")).toBe("Hello");
          expect(result.current.t("Goodbye")).toBe("Goodbye");
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
          expect(result.current.t("Hello")).toBe("Olá");
          expect(result.current.t("Goodbye")).toBe("Adeus");
        });
      });

      describe("Missing Translation", () => {
        it("should return input text and log warning when translation is missing", () => {
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
          const resultText = result.current.t("NonExistentText");
          expect(resultText).toBe("NonExistentText");
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining(
              "[Translator Debug] Missing translation \"en\" for: 'NonExistentText'"
            )
          );
          consoleWarnSpy.mockRestore();
        });

        it("should return input text when translation exists but not for current language", () => {
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
          const resultText = result.current.t("Hello");
          expect(resultText).toBe("Hello");
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining(
              "[Translator Debug] Missing translation \"fr\" for: 'Hello'"
            )
          );
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
          expect(result.current.t("hello")).toBe("Hello");
          expect(result.current.t("HELLO")).toBe("Hello");
          expect(result.current.t("Hello")).toBe("Hello");
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
          expect(result.current.t("hello")).toBe("Olá");
          expect(result.current.t("HELLO")).toBe("Olá");
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
        expect(result.current.t("Hello")).toBe("Hello");
        act(() => {
          result.current.setLanguage("es");
        });
        expect(result.current.t("Hello")).toBe("Hola");
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

      it("should return input text when translations array is empty", () => {
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
        const resultText = result.current.t("Hello");
        expect(resultText).toBe("Hello");
        expect(consoleWarnSpy).toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
      });
    });

    describe("Missing Translation Warnings", () => {
      it("should log warning for missing translations", () => {
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
        result.current.t("NonExistentText");
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "[Translator Debug] Missing translation \"en\" for: 'NonExistentText'"
          )
        );
        consoleWarnSpy.mockRestore();
      });

      it("should log warning for each missing translation call", () => {
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
        result.current.t("Missing1");
        result.current.t("Missing2");
        expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
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
        expect(result.current.t("hello")).toBe("Hello");
        expect(result.current.t("HELLO")).toBe("Hello");
        expect(result.current.t("Hello")).toBe("Hello");
        expect(result.current.t("HeLLo")).toBe("Hello");
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
        expect(result.current.t("hello")).toBe("Olá");
        expect(result.current.t("HELLO")).toBe("Olá");
        expect(result.current.t("Hello")).toBe("Olá");
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

      it("should return input text when switching to invalid language and translation is missing", () => {
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
        const resultText = result.current.t("Hello");
        expect(resultText).toBe("Hello");
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "[Translator Debug] Missing translation \"fr\" for: 'Hello'"
          )
        );
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
