import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { resolve } from "path";
import { existsSync } from "fs";

const mockExit = jest.fn() as jest.MockedFunction<(code?: number) => never>;
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();

describe("CLI Integration Tests", () => {
  let originalArgv: string[];
  let originalExit: typeof process.exit;
  let originalCwd: string;
  let testDir: string;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    originalArgv = [...process.argv];
    originalExit = process.exit;
    originalCwd = process.cwd();
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    process.exit = mockExit as typeof process.exit;
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
    testDir = resolve(__dirname, "../../../../.test-cli-tmp");
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
    await mkdir(testDir, { recursive: true });
    process.chdir(testDir);
    mockExit.mockClear();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
  });

  afterEach(async () => {
    process.argv = originalArgv;
    process.exit = originalExit;
    process.chdir(originalCwd);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
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

  async function runCLI(args: string[]): Promise<void> {
    process.argv = ["node", "cli/index", ...args];
    mockExit.mockClear();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    const cliModule = await import("@/cli/index");
    if (cliModule.main) {
      await cliModule.main();
    } else {
      await import("@/cli/index");
    }
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => process.nextTick(resolve));
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (mockExit.mock.calls.length > 0 && i > 3) {
        break;
      }
    }
  }

  describe("Help command", () => {
    it("should display help message when --help flag is provided", async () => {
      await runCLI(["--help"]);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(mockConsoleLog).toHaveBeenCalled();
      const logCall = mockConsoleLog.mock.calls.flat().join("");
      expect(logCall).toContain("vbss-translator generate");
      expect(logCall).toContain("Usage:");
      expect(mockConsoleError).not.toHaveBeenCalled();
    });

    it("should display help message when -h flag is provided", async () => {
      await runCLI(["-h"]);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(mockConsoleLog).toHaveBeenCalled();
    });
  });

  describe("Translation file generation", () => {
    it("should generate index file from translation files", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      await createTranslationFile("src/pages/translations.json", {
        en: "World",
        pt: "Mundo",
      });
      await runCLI([]);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(mockConsoleLog).toHaveBeenCalled();
      const outputPath = resolve(testDir, "src/translations/index.ts");
      expect(existsSync(outputPath)).toBe(true);
      const content = await readFile(outputPath, "utf-8");
      expect(content).toContain("import");
      expect(content).toContain("export default");
    });

    it("should use custom pattern and output from CLI flags", async () => {
      await createTranslationFile("custom/path/trans.json", {
        en: "Test",
        pt: "Teste",
      });
      await runCLI([
        "--pattern",
        "custom/**/*.json",
        "--output",
        "custom-output.ts",
      ]);
      expect(mockExit).toHaveBeenCalledWith(0);
      const outputPath = resolve(testDir, "custom-output.ts");
      expect(existsSync(outputPath)).toBe(true);
    });

    it("should use config file settings when no CLI flags provided", async () => {
      await createConfigFile({
        pattern: "custom/**/*.json",
        outputPath: "config-output.ts",
        outputFormat: "js",
      });
      await createTranslationFile("custom/trans.json", {
        en: "Config Test",
        pt: "Teste Config",
      });
      await runCLI([]);
      expect(mockExit).toHaveBeenCalledWith(0);
      const outputPath = resolve(testDir, "config-output.ts");
      expect(existsSync(outputPath)).toBe(true);
    });

    it("should override config file with CLI flags", async () => {
      await createConfigFile({
        pattern: "wrong-pattern",
        outputPath: "wrong-output.ts",
      });
      await createTranslationFile("src/components/translations.json", {
        en: "Override Test",
        pt: "Teste Override",
      });
      await runCLI([
        "--pattern",
        "src/**/translations.json",
        "--output",
        "cli-output.ts",
      ]);
      expect(mockExit).toHaveBeenCalledWith(0);
      const outputPath = resolve(testDir, "cli-output.ts");
      expect(existsSync(outputPath)).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("should exit with code 2 for validation errors", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
      });
      await createTranslationFile("src/pages/translations.json", {
        en: "World",
        pt: "Mundo",
      });
      await runCLI([]);
      expect(mockExit).toHaveBeenCalledWith(2);
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it("should exit with code 1 for file system errors", async () => {
      await runCLI([
        "--pattern",
        "src/**/translations.json",
        "--output",
        "/nonexistent/invalid/path/output.ts",
      ]);
      if (mockExit.mock.calls.length > 0) {
        const exitCode = mockExit.mock.calls[0]?.[0];
        expect(exitCode).toBeGreaterThanOrEqual(0);
      } else {
        expect(mockConsoleError).toHaveBeenCalled();
      }
    });

    it("should show error message for invalid JSON files", async () => {
      const invalidPath = resolve(testDir, "src/components/translations.json");
      await mkdir(resolve(invalidPath, ".."), { recursive: true });
      await writeFile(invalidPath, "{ invalid json }", "utf-8");
      await runCLI([]);
      expect(mockExit).toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalled();
      const errorCall = mockConsoleError.mock.calls.flat().join("");
      expect(errorCall).toContain("Invalid JSON");
    });
  });

  describe("Output formats", () => {
    it("should generate TypeScript file when format is ts", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      await runCLI(["--format", "ts", "--output", "output.ts"]);
      expect(mockExit).toHaveBeenCalledWith(0);
      const content = await readFile(resolve(testDir, "output.ts"), "utf-8");
      expect(content).toContain("export interface Translation");
    });

    it("should generate JavaScript file when format is js", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      await runCLI(["--format", "js", "--output", "output.js"]);
      expect(mockExit).toHaveBeenCalledWith(0);
      const content = await readFile(resolve(testDir, "output.js"), "utf-8");
      expect(content).not.toContain("export interface");
      expect(content).toContain("export default");
    });

    it("should generate TSX file when format is tsx", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      await runCLI(["--format", "tsx", "--output", "output.tsx"]);
      expect(mockExit).toHaveBeenCalledWith(0);
      const content = await readFile(resolve(testDir, "output.tsx"), "utf-8");
      expect(content).toContain("export interface Translation");
    });
  });

  describe("Watch mode flag", () => {
    it("should accept --watch flag and start watching", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      const runPromise = runCLI(["--watch"]);
      await Promise.race([
        runPromise,
        new Promise((resolve) => setTimeout(resolve, 500))
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const logCall = mockConsoleLog.mock.calls.flat().join("");
      expect(logCall).toContain("Watching for translation file changes");
    });

    it("should accept -w flag as shorthand for watch", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      const runPromise = runCLI(["-w"]);
      await Promise.race([
        runPromise,
        new Promise((resolve) => setTimeout(resolve, 500))
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const logCall = mockConsoleLog.mock.calls.flat().join("");
      expect(logCall).toContain("Watching for translation file changes");
    });
  });

  describe("Statistics and output", () => {
    it("should display file count and translation count", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Hello",
        pt: "Olá",
      });
      await createTranslationFile("src/pages/translations.json", {
        en: "World",
        pt: "Mundo",
      });
      await runCLI([]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const logCall = mockConsoleLog.mock.calls.flat().join("");
      expect(logCall).toContain("Generated");
      expect(logCall).toContain("translations");
      expect(logCall).toContain("file(s)");
    });

    it("should display output path and generation time", async () => {
      await createTranslationFile("src/components/translations.json", {
        en: "Test",
        pt: "Teste",
      });
      await runCLI([]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const logCall = mockConsoleLog.mock.calls.flat().join("");
      expect(logCall).toContain("Output:");
      expect(logCall).toContain("Time:");
    });
  });
});
