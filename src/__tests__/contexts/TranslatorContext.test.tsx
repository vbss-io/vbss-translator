import { renderHook } from "@testing-library/react";
import {
  TranslatorContext,
  useTranslatorContext,
} from "@/contexts/TranslatorContext";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { mockTranslations } from "@/__tests__/helpers/fixtures";
import type { TranslatorContextType } from "@/types";

describe("TranslatorContext", () => {
  describe("Context Creation", () => {
    it("should create context with initial null value", () => {
      expect(TranslatorContext).toBeDefined();
    });
  });

  describe("useTranslatorContext", () => {
    describe("Error Handling", () => {
      it("should throw error when used outside provider", () => {
        const consoleSpy = jest
          .spyOn(console, "error")
          .mockImplementation(() => {});
        expect(() => {
          renderHook(() => useTranslatorContext());
        }).toThrow(
          "useTranslatorContext must be used within a TranslatorProvider"
        );
        consoleSpy.mockRestore();
      });
    });

    describe("Success Cases", () => {
      it("should return context when used within provider", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TranslatorProvider translations={mockTranslations}>
            {children}
          </TranslatorProvider>
        );
        const { result } = renderHook(() => useTranslatorContext(), {
          wrapper,
        });
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

      it("should return context with correct initial values from provider", () => {
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
        expect(result.current.language).toBe("pt");
        expect(result.current.languages).toEqual(["en", "pt", "es"]);
      });
    });
  });
});
