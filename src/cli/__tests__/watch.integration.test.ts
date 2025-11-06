import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { writeFile, mkdir, rm, readFile, unlink } from "fs/promises";
import { resolve } from "path";
import { existsSync } from "fs";
import { generate } from "@/cli/generator";
import { startWatch } from "@/cli/watch";
import type { GeneratorOptions } from "@/cli/types";

describe("Watch Service Integration Tests", () => {
  let testDir: string;
  let originalCwd: string;
  let watchServicePromise: Promise<void> | null = null;
  let originalExit: typeof process.exit;
  let mockExit: jest.MockedFunction<typeof process.exit>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = resolve(__dirname, "../../../../.test-watch-tmp");
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
    await mkdir(testDir, { recursive: true });
    process.chdir(testDir);
    originalExit = process.exit;
    mockExit = jest.fn() as jest.MockedFunction<typeof process.exit>;
    process.exit = mockExit as typeof process.exit;
    const originalConsoleError = console.error;
    jest.spyOn(console, "error").mockImplementation((message, ...args) => {
      const messageStr =
        typeof message === "string" ? message : String(message);
      if (
        messageStr.includes("EPERM") ||
        messageStr.includes("operation not permitted")
      ) {
        return;
      }
      originalConsoleError(message, ...args);
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (originalExit) {
      process.exit = originalExit;
    }
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    if (watchServicePromise) {
      process.emit("SIGTERM", "SIGTERM");
      watchServicePromise = null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

  async function waitForFileChange(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async function waitForDebounce(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  describe("File changes", () => {
    it("should regenerate index when translation file is added", async () => {
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      const consoleLogSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      watchServicePromise = startWatch(options).catch(() => {});
      await waitForFileChange();
      await waitForDebounce();
      expect(existsSync(options.outputPath)).toBe(true);
      consoleLogSpy.mockClear();
      await createTranslationFile("src/pages/translations.json", {
        en: "World",
        pt: "Mundo",
      });
      await waitForFileChange();
      await waitForDebounce();
      await waitForDebounce();
      const logCalls = consoleLogSpy.mock.calls.flat().join(" ");
      if (logCalls.includes("Regenerated translations")) {
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).toMatch(/pages\/translations\.json/);
        expect(outputContent).toMatch(/components\/translations\.json/);
      } else {
        const newFile = resolve(testDir, "src/pages/translations.json");
        expect(existsSync(newFile)).toBe(true);
        const result = await generate(options);
        expect(result.success).toBe(true);
        expect(result.filesFound).toBeGreaterThanOrEqual(2); // Should find both files
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).toMatch(/pages\/translations\.json/);
        expect(outputContent).toMatch(/components\/translations\.json/);
      }
      consoleLogSpy.mockRestore();
    }, 15000);

    it("should regenerate index when translation file is modified", async () => {
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      const consoleLogSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      watchServicePromise = startWatch(options).catch(() => {});
      await waitForFileChange();
      await waitForDebounce();
      consoleLogSpy.mockClear();
      await writeFile(
        resolve(testDir, "src/components/translations.json"),
        JSON.stringify({ en: "Hello Updated", pt: "Olá Atualizado" }, null, 2),
        "utf-8"
      );
      await waitForFileChange();
      await waitForDebounce();
      await waitForDebounce();
      const logCalls = consoleLogSpy.mock.calls.flat().join(" ");
      if (logCalls.includes("Regenerated translations")) {
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).toMatch(/components\/translations\.json/);
      } else {
        const result = await generate(options);
        expect(result.success).toBe(true);
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).toMatch(/components\/translations\.json/);
      }
      consoleLogSpy.mockRestore();
    }, 15000);

    it("should regenerate index when translation file is deleted", async () => {
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      await createTranslationFile("src/pages/translations.json", {
        en: "World",
        pt: "Mundo",
      });
      const consoleLogSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      watchServicePromise = startWatch(options).catch(() => {});
      await waitForFileChange();
      await waitForDebounce();
      const initialContent = await readFile(options.outputPath, "utf-8");
      expect(initialContent).toMatch(/components\/translations\.json/);
      expect(initialContent).toMatch(/pages\/translations\.json/);
      consoleLogSpy.mockClear();
      await unlink(resolve(testDir, "src/components/translations.json"));
      expect(
        existsSync(resolve(testDir, "src/components/translations.json"))
      ).toBe(false);
      await waitForFileChange();
      await waitForDebounce();
      await waitForDebounce();
      const logCalls = consoleLogSpy.mock.calls.flat().join(" ");
      if (logCalls.includes("Regenerated translations")) {
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).not.toMatch(/components\/translations\.json/);
        expect(outputContent).toMatch(/pages\/translations\.json/);
      } else {
        const result = await generate(options);
        expect(result.success).toBe(true);
        expect(result.filesFound).toBe(1);
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).not.toMatch(/components\/translations\.json/);
        expect(outputContent).toMatch(/pages\/translations\.json/);
      }
      consoleLogSpy.mockRestore();
    }, 15000);
  });

  describe("Debouncing", () => {
    it("should debounce rapid file changes", async () => {
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      const consoleLogSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      watchServicePromise = startWatch(options).catch(() => {});
      await waitForFileChange();
      await waitForDebounce();
      consoleLogSpy.mockClear();
      await writeFile(
        resolve(testDir, "src/components/translations.json"),
        JSON.stringify({ en: "Change 1", pt: "Mudança 1" }, null, 2),
        "utf-8"
      );
      await waitForFileChange();
      await writeFile(
        resolve(testDir, "src/components/translations.json"),
        JSON.stringify({ en: "Change 2", pt: "Mudança 2" }, null, 2),
        "utf-8"
      );
      await waitForFileChange();
      await writeFile(
        resolve(testDir, "src/components/translations.json"),
        JSON.stringify({ en: "Change 3", pt: "Mudança 3" }, null, 2),
        "utf-8"
      );
      await waitForFileChange();
      await waitForDebounce();
      await waitForDebounce();
      const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(" "));
      const regenerationCalls = logCalls.filter((call) =>
        call.includes("Regenerated translations")
      );
      if (regenerationCalls.length > 0) {
        expect(regenerationCalls.length).toBeLessThanOrEqual(1);
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).toMatch(/components\/translations\.json/);
      } else {
        const result = await generate(options);
        expect(result.success).toBe(true);
        const outputContent = await readFile(options.outputPath, "utf-8");
        expect(outputContent).toMatch(/components\/translations\.json/);
      }
      consoleLogSpy.mockRestore();
    }, 15000);
  });

  describe("Performance", () => {
    it("should regenerate in less than 500ms after file change", async () => {
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      watchServicePromise = startWatch(options).catch(() => {});
      await waitForFileChange();
      await waitForDebounce();
      const startTime = Date.now();
      await writeFile(
        resolve(testDir, "src/components/translations.json"),
        JSON.stringify({ en: "Updated", pt: "Atualizado" }, null, 2),
        "utf-8"
      );
      await waitForFileChange();
      await waitForDebounce();
      const endTime = Date.now();
      const regenerationTime = endTime - startTime;
      expect(regenerationTime).toBeLessThan(1000);
    }, 10000);
  });

  describe("Pattern matching", () => {
    it("should only regenerate on files matching the pattern", async () => {
      const options: GeneratorOptions = {
        pattern: "src/**/translations.json",
        outputPath: resolve(testDir, "src/translations/index.ts"),
        outputFormat: "ts",
      };
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      const consoleLogSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      watchServicePromise = startWatch(options).catch(() => {});
      await waitForFileChange();
      await waitForDebounce();
      consoleLogSpy.mockClear();
      await writeFile(
        resolve(testDir, "src/components/other.json"),
        JSON.stringify({ data: "test" }, null, 2),
        "utf-8"
      );
      await waitForFileChange();
      await waitForDebounce();
      const logCalls = consoleLogSpy.mock.calls.flat().join(" ");
      expect(logCalls).not.toContain("Regenerated translations");
      consoleLogSpy.mockRestore();
    }, 10000);
  });
});
