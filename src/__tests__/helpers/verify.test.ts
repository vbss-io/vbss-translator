import { mockTranslations } from "./fixtures";
import type { Translation } from "@/types";

describe("Jest Configuration Verification", () => {
  it("should execute TypeScript test files", () => {
    expect(true).toBe(true);
  });

  it("should resolve path aliases (@/*)", () => {
    const testTranslation: Translation = { en: "test", pt: "teste" };
    expect(testTranslation).toBeDefined();
    expect(testTranslation.en).toBe("test");
  });

  it("should load test fixtures correctly", () => {
    expect(mockTranslations).toBeDefined();
    expect(mockTranslations.length).toBeGreaterThan(0);
    expect(mockTranslations[0]).toHaveProperty("en");
    expect(mockTranslations[0]).toHaveProperty("pt");
    expect(mockTranslations[0]).toHaveProperty("es");
  });
});
