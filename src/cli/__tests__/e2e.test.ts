import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { generate } from "@/cli/generator";
import type { GeneratorOptions } from "@/cli/types";

describe("E2E: Translation File Generation", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = resolve(__dirname, "../../../../.test-e2e-tmp");
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
    await mkdir(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  async function createTranslationFile(
    path: string,
    content: Record<string, string> | Array<Record<string, string>>
  ): Promise<void> {
    const fullPath = resolve(testDir, path);
    const dir = resolve(fullPath, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, JSON.stringify(content, null, 2), "utf-8");
  }

  async function createConfigFile(
    content: Record<string, unknown>
  ): Promise<void> {
    const configPath = resolve(testDir, "vbss-translator.config.json");
    await writeFile(configPath, JSON.stringify(content, null, 2), "utf-8");
  }

  describe("Full workflow: Config file → Generation → Verification", () => {
    it("should generate index file from config file and verify content", async () => {
      await createConfigFile({
        pattern: "src/**/translations.json",
        outputPath: "src/translations/index.ts",
        outputFormat: "ts",
        referenceLanguage: "en",
      });
      await createTranslationFile("src/components/button/translations.json", {
        en: "Hello",
        pt: "Olá",
        es: "Hola",
      });
      await createTranslationFile("src/components/modal/translations.json", {
        en: "World",
        pt: "Mundo",
        es: "Mundo",
      });
      await createTranslationFile("src/pages/home/translations.json", {
        en: "Goodbye",
        pt: "Adeus",
        es: "Adiós",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
        referenceLanguage: "en",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(3);
      expect(result.translationsGenerated).toBe(3);
      expect(result.errors).toHaveLength(0);
      const outputPath = resolve(testDir, "src/translations/index.ts");
      expect(existsSync(outputPath)).toBe(true);
      const content = await readFile(outputPath, "utf-8");
      expect(content).toContain("import translations0 from");
      expect(content).toContain("import translations1 from");
      expect(content).toContain("import translations2 from");
      expect(content).toContain("export interface Translation");
      expect(content).toContain("en: string");
      expect(content).toContain("pt: string");
      expect(content).toContain("es: string");
      expect(content).toContain("uniqueTranslations");
      expect(content).toContain("t.en === translation.en");
      expect(content).toContain("export default uniqueTranslations");
    });

    it("should handle array translations in files", async () => {
      await createTranslationFile("src/components/translations.json", [
        { en: "Hello", pt: "Olá" },
        { en: "World", pt: "Mundo" },
        { en: "Goodbye", pt: "Adeus" },
      ]);
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.translationsGenerated).toBe(3);
      const content = await readFile(
        resolve(testDir, "src/translations/index.ts"),
        "utf-8"
      );
      expect(content).toContain("...translations0");
    });

    it("should deduplicate translations correctly", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      await createTranslationFile("src/pages/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      await createTranslationFile("src/utils/translations.json", {
        en: "World",
        pt: "Mundo",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
        referenceLanguage: "en",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(3);
      expect(result.translationsGenerated).toBe(2);
    });
  });

  describe("Edge cases: Empty projects", () => {
    it("should handle empty project with no translation files", async () => {
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(0);
      expect(result.translationsGenerated).toBe(0);
      expect(result.errors).toHaveLength(0);
      const outputPath = resolve(testDir, "src/translations/index.ts");
      if (existsSync(outputPath)) {
        const content = await readFile(outputPath, "utf-8");
        expect(content).toContain("export default []");
      }
    });
  });

  describe("Edge cases: Deeply nested directories", () => {
    it("should handle files in deeply nested directory structures", async () => {
      const deepPath =
        "src/features/auth/components/login/forms/button/translations.json";
      await createTranslationFile(deepPath, {
        en: "Submit",
        pt: "Enviar",
      });
      const nestedPath =
        "src/pages/dashboard/components/sidebar/menu/items/translations.json";
      await createTranslationFile(nestedPath, {
        en: "Settings",
        pt: "Configurações",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(2);
      expect(result.translationsGenerated).toBe(2);
      const content = await readFile(
        resolve(testDir, "src/translations/index.ts"),
        "utf-8"
      );
      expect(content).toMatch(/import translations0 from/);
      expect(content).toMatch(/import translations1 from/);
    });
  });

  describe("Edge cases: Large projects", () => {
    it("should handle projects with many translation files", async () => {
      const files: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        files.push(
          createTranslationFile(
            `src/components/component${i}/translations.json`,
            {
              en: `Translation ${i}`,
              pt: `Tradução ${i}`,
            }
          )
        );
      }
      await Promise.all(files);
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const startTime = Date.now();
      const result = await generate(options);
      const duration = Date.now() - startTime;
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(50);
      expect(result.translationsGenerated).toBe(50);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe("Cross-platform compatibility: Path handling", () => {
    it("should normalize Windows paths to forward slashes in imports", async () => {
      await createTranslationFile("src\\components\\translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      await createTranslationFile("src\\pages\\translations.json", {
        en: "World",
        pt: "Mundo",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      const content = await readFile(
        resolve(testDir, "src/translations/index.ts"),
        "utf-8"
      );
      expect(content).not.toContain("\\");
      expect(content).toMatch(
        /import translations0 from ['"]\.\.\/components\/translations\.json/
      );
      expect(content).toMatch(
        /import translations1 from ['"]\.\.\/pages\/translations\.json/
      );
    });

    it("should handle output paths with different separators", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      const outputPath = join(testDir, "output", "translations", "index.ts");
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath,
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(existsSync(outputPath)).toBe(true);
    });

    it("should calculate relative paths correctly for nested structures", async () => {
      await createTranslationFile("src/components/button/translations.json", {
        en: "Click",
        pt: "Clique",
      });
      await createTranslationFile("src/pages/home/translations.json", {
        en: "Welcome",
        pt: "Bem-vindo",
      });
      const outputPath = resolve(
        testDir,
        "src/presentation/translations/index.ts"
      );
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath,
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      const content = await readFile(outputPath, "utf-8");
      expect(content).toMatch(
        /import translations0 from ['"]\.\.\/\.\.\/components\/button\/translations\.json/
      );
      expect(content).toMatch(
        /import translations1 from ['"]\.\.\/\.\.\/pages\/home\/translations\.json/
      );
    });
  });

  describe("Error scenarios", () => {
    it("should fail when translation files have inconsistent languages", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      await createTranslationFile("src/pages/translations.json", {
        en: "World",
        es: "Mundo",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.type === "missing_languages")).toBe(
        true
      );
      const outputPath = resolve(testDir, "src/translations/index.ts");
      expect(existsSync(outputPath)).toBe(false);
    });

    it("should handle malformed JSON files gracefully", async () => {
      const invalidPath = resolve(testDir, "src/components/translations.json");
      await mkdir(resolve(invalidPath, ".."), { recursive: true });
      await writeFile(invalidPath, "{ invalid json }", "utf-8");
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === "invalid_json")).toBe(true);
    });
  });

  describe("Output format variations", () => {
    it("should generate JavaScript format correctly", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.js"),
        outputFormat: "js",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      const content = await readFile(
        resolve(testDir, "src/translations/index.js"),
        "utf-8"
      );
      expect(content).not.toContain("export interface");
      expect(content).toContain("const allTranslations = [");
      expect(content).toContain("export default uniqueTranslations");
    });

    it("should generate TSX format correctly", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.tsx"),
        outputFormat: "tsx",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      const content = await readFile(
        resolve(testDir, "src/translations/index.tsx"),
        "utf-8"
      );
      expect(content).toContain("export interface Translation");
      expect(content).toContain(": Translation[]");
    });
  });

  describe("Reference language handling", () => {
    it("should use custom reference language for deduplication", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
        es: "Hola",
      });
      await createTranslationFile("src/pages/translations.json", {
        en: "Hello",
        pt: "Olá",
        es: "Hola diferente",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
        referenceLanguage: "es",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.translationsGenerated).toBe(2);
    });

    it("should default to first language when reference language not specified", async () => {
      await createTranslationFile("src/components/translations.json", {
        pt: "Olá",
        en: "Hello",
      });
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const result = await generate(options);
      expect(result.success).toBe(true);
      const content = await readFile(
        resolve(testDir, "src/translations/index.ts"),
        "utf-8"
      );
      expect(content).toContain("t.pt === translation.pt");
    });
  });

  describe("Performance: Build tool integration", () => {
    it("should complete generation in under 500ms for typical projects (< 100 files)", async () => {
      const files: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        files.push(
          createTranslationFile(
            `src/components/component${i}/translations.json`,
            {
              en: `Translation ${i}`,
              pt: `Tradução ${i}`,
              es: `Traducción ${i}`,
            }
          )
        );
      }
      await Promise.all(files);
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const startTime = Date.now();
      const result = await generate(options);
      const duration = Date.now() - startTime;
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(50);
      expect(duration).toBeLessThan(500);
    });

    it("should handle multiple languages efficiently", async () => {
      const languages: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        languages[`lang${i}`] = `Translation ${i}`;
      }
      const files: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        files.push(
          createTranslationFile(
            `src/components/component${i}/translations.json`,
            languages
          )
        );
      }
      await Promise.all(files);
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      const startTime = Date.now();
      const result = await generate(options);
      const duration = Date.now() - startTime;
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(500);
    });

    it("should maintain performance with deduplication", async () => {
      const files: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        const translationIndex = Math.floor(i / 2);
        files.push(
          createTranslationFile(
            `src/components/component${i}/translations.json`,
            {
              en: `Translation ${translationIndex}`,
              pt: `Tradução ${translationIndex}`,
            }
          )
        );
      }
      await Promise.all(files);
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
        referenceLanguage: "en",
      };
      const startTime = Date.now();
      const result = await generate(options);
      const duration = Date.now() - startTime;
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(50);
      expect(result.translationsGenerated).toBe(25);
      expect(duration).toBeLessThan(500);
    });
  });
});
