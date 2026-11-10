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

  describe("factory and generator exports", () => {
    it("exports createTranslationProvider from the provider factory", async () => {
      const entry = await import("@/index");
      const factory = await import("@/external/providers/factory");
      expect(entry.createTranslationProvider).toBe(
        factory.createTranslationProvider
      );
    });

    it("exports generate from the generator entry", async () => {
      const entry = await import("@/generator");
      const cli = await import("@/cli/generator");
      expect(entry.generate).toBe(cli.generate);
    });

    it("exports generate from the cli api entry", async () => {
      const entry = await import("@/cli/api");
      const cli = await import("@/cli/generator");
      expect(entry.generate).toBe(cli.generate);
    });
  });

  describe("Public API exports", () => {
    it("should export both TranslatorProvider and useTranslator", () => {
      expect(TranslatorProvider).toBeDefined();
      expect(useTranslator).toBeDefined();
    });
  });
});
