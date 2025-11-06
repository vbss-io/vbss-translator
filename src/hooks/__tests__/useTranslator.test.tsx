import { renderHook, act } from "@testing-library/react";
import { useTranslator } from "@/hooks/useTranslator";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { mockTranslations } from "@/__tests__/helpers/fixtures";
import type { TranslatorContextType } from "@/types";

describe("useTranslator", () => {
  describe("Context Shape", () => {
    it("should return correct context shape with all required properties", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslator(), { wrapper });
      expect(result.current).toBeDefined();
      expect(result.current).toHaveProperty("t");
      expect(result.current).toHaveProperty("language");
      expect(result.current).toHaveProperty("languages");
      expect(result.current).toHaveProperty("setLanguage");
      const context = result.current as TranslatorContextType;
      expect(typeof context.t).toBe("function");
      expect(typeof context.language).toBe("string");
      expect(Array.isArray(context.languages)).toBe(true);
      expect(typeof context.setLanguage).toBe("function");
    });

    it("should return context with correct initial values", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          defaultLanguage="pt"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslator(), { wrapper });
      expect(result.current.language).toBe("pt");
      expect(result.current.languages).toEqual(["en", "pt", "es"]);
    });
  });

  describe("Context Delegation", () => {
    it("should delegate to useTranslatorContext and return its result", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslator(), { wrapper });
      expect(result.current.t("Hello")).toBe("Hello");
      expect(result.current.language).toBe("en");
      expect(result.current.languages).toEqual(["en", "pt", "es"]);
      const { setLanguage } = result.current;
      expect(typeof setLanguage).toBe("function");
    });

    it("should throw error when used outside provider (delegates error handling)", () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      expect(() => {
        renderHook(() => useTranslator());
      }).toThrow(
        "useTranslatorContext must be used within a TranslatorProvider"
      );
      consoleSpy.mockRestore();
    });
  });

  describe("Functionality", () => {
    it("should allow translation lookups through t function", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslator(), { wrapper });
      expect(result.current.t("Hello")).toBe("Hello");
      expect(result.current.t("Goodbye")).toBe("Goodbye");
    });

    it("should allow language switching through setLanguage", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TranslatorProvider
          translations={mockTranslations}
          defaultLanguage="en"
        >
          {children}
        </TranslatorProvider>
      );
      const { result } = renderHook(() => useTranslator(), { wrapper });
      expect(result.current.language).toBe("en");
      expect(result.current.t("Hello")).toBe("Hello");
      const { setLanguage } = result.current;
      act(() => {
        setLanguage("pt");
      });
      expect(result.current.language).toBe("pt");
      expect(result.current.t("Hello")).toBe("Olá");
    });
  });
});
