import { TranslatorProvider, useTranslator } from "@/index";
import { TranslatorProvider as TranslatorProviderOriginal } from "@/contexts/TranslatorProvider";
import { useTranslator as useTranslatorOriginal } from "@/hooks/useTranslator";

describe("index.ts exports", () => {
  describe("TranslatorProvider export", () => {
    it("should export TranslatorProvider from contexts", () => {
      expect(TranslatorProvider).toBe(TranslatorProviderOriginal);
      expect(typeof TranslatorProvider).toBe("function");
    });
  });

  describe("useTranslator export", () => {
    it("should export useTranslator from hooks", () => {
      expect(useTranslator).toBe(useTranslatorOriginal);
      expect(typeof useTranslator).toBe("function");
    });
  });

  describe("Public API exports", () => {
    it("should export both TranslatorProvider and useTranslator", () => {
      expect(TranslatorProvider).toBeDefined();
      expect(useTranslator).toBeDefined();
    });
  });
});
