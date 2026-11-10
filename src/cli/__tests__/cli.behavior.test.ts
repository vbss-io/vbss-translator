import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { resolve } from "path";
import { generate } from "@/cli/generator";
import { startWatch } from "@/cli/watch";
import { configLoader } from "@/cli/config";
import type { Config, GenerationResult } from "@/cli/types";

jest.mock("@/cli/generator");
jest.mock("@/cli/watch");
jest.mock("@/cli/config", () => {
  const actual = jest.requireActual<typeof import("@/cli/config")>(
    "@/cli/config"
  );
  return {
    configLoader: {
      loadFromFile: jest.fn(),
      loadFromArgs: actual.configLoader.loadFromArgs.bind(actual.configLoader),
      merge: actual.configLoader.merge.bind(actual.configLoader),
    },
  };
});

const mockGenerate = generate as jest.MockedFunction<typeof generate>;
const mockStartWatch = startWatch as jest.MockedFunction<typeof startWatch>;
const mockLoadFromFile = configLoader.loadFromFile as jest.MockedFunction<
  typeof configLoader.loadFromFile
>;

const successResult = (
  overrides: Partial<GenerationResult> = {}
): GenerationResult => ({
  success: true,
  filesFound: 3,
  translationsGenerated: 7,
  errors: [],
  outputPath: "/abs/out.ts",
  ...overrides,
});

describe("cli main behavior", () => {
  let originalArgv: string[];
  let exit: jest.SpiedFunction<typeof process.exit>;
  let log: jest.SpiedFunction<typeof console.log>;
  let error: jest.SpiedFunction<typeof console.error>;

  const run = async (...args: string[]) => {
    process.argv = ["node", "cli/index", ...args];
    const { main } = await import("@/cli/index");
    await main();
  };

  const output = (spy: jest.SpiedFunction<typeof console.log>) =>
    spy.mock.calls.flat().join("\n");

  beforeEach(() => {
    jest.clearAllMocks();
    originalArgv = [...process.argv];
    exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    log = jest.spyOn(console, "log").mockImplementation(() => {});
    error = jest.spyOn(console, "error").mockImplementation(() => {});
    mockLoadFromFile.mockResolvedValue(null);
    mockGenerate.mockResolvedValue(successResult());
    mockStartWatch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.argv = originalArgv;
    exit.mockRestore();
    log.mockRestore();
    error.mockRestore();
  });

  describe("help", () => {
    it.each([["--help"], ["-h"]])("prints usage and exits 0 for %s", async (flag) => {
      exit.mockImplementationOnce((() => {
        throw new Error("exit called");
      }) as never);
      await expect(run(flag)).rejects.toThrow("exit called");
      expect(exit).toHaveBeenCalledWith(0);
      const text = output(log);
      expect(text).toContain("vbss-translator generate");
      expect(text).toContain("--pattern <glob>");
      expect(text).toContain("--watch, -w");
      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  describe("argument parsing", () => {
    it("uses defaults when no flags and no config file are given", async () => {
      await run();
      expect(mockGenerate).toHaveBeenCalledWith({
        pattern: "src/**/translations.json",
        outputPath: resolve(process.cwd(), "src/translations/index.ts"),
        outputFormat: "ts",
        referenceLanguage: undefined,
        watch: false,
      });
    });

    it("reads a flag value from the next argument", async () => {
      await run("--pattern", "lib/**/t.json", "--format", "js");
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: "lib/**/t.json", outputFormat: "js" })
      );
    });

    it("reads a flag value written with an equals sign and keeps further equals signs", async () => {
      await run("--output=out/a=b.ts", "--reference-language=pt");
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          outputPath: resolve(process.cwd(), "out/a=b.ts"),
          referenceLanguage: "pt",
        })
      );
    });

    it("treats an empty equals value as a boolean flag and falls back to defaults", async () => {
      await run("--pattern=");
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: "src/**/translations.json" })
      );
    });

    it("treats a flag followed by another flag as boolean", async () => {
      await run("--pattern", "--format", "tsx");
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: "src/**/translations.json",
          outputFormat: "tsx",
        })
      );
    });

    it("ignores positional arguments", async () => {
      await run("generate", "extra", "--format", "js");
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ outputFormat: "js" })
      );
    });
  });

  describe("configuration", () => {
    it("loads vbss-translator.config.json from the working directory by default", async () => {
      await run();
      expect(mockLoadFromFile).toHaveBeenCalledWith(
        resolve(process.cwd(), "vbss-translator.config.json")
      );
    });

    it("loads the file named by --config", async () => {
      await run("--config", "conf/custom.json");
      expect(mockLoadFromFile).toHaveBeenCalledWith(
        resolve(process.cwd(), "conf/custom.json")
      );
    });

    it("falls back to the default config name when --config has no value", async () => {
      await run("--config");
      expect(mockLoadFromFile).toHaveBeenCalledWith(
        resolve(process.cwd(), "vbss-translator.config.json")
      );
    });

    it("applies config file values and lets flags override them", async () => {
      const fileConfig: Config = {
        pattern: "from-file/**/*.json",
        outputPath: "from-file/out.ts",
        outputFormat: "js",
        referenceLanguage: "en",
      };
      mockLoadFromFile.mockResolvedValue(fileConfig);
      await run("--output", "flag/out.ts");
      expect(mockGenerate).toHaveBeenCalledWith({
        pattern: "from-file/**/*.json",
        outputPath: resolve(process.cwd(), "flag/out.ts"),
        outputFormat: "js",
        referenceLanguage: "en",
        watch: false,
      });
    });
  });

  describe("watch mode", () => {
    it.each([["--watch"], ["-w"]])("starts watching for %s without a one shot generation", async (flag) => {
      await run(flag);
      expect(mockStartWatch).toHaveBeenCalledWith(
        expect.objectContaining({ watch: true })
      );
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    });

    it("does not start watching when --watch is given a value", async () => {
      await run("--watch=false");
      expect(mockStartWatch).not.toHaveBeenCalled();
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe("results", () => {
    it("prints the search pattern, totals, output path and time and exits 0", async () => {
      mockGenerate.mockResolvedValue(
        successResult({ outputPath: "/abs/out.ts" })
      );
      await run("--pattern", "x/**/t.json");
      const text = output(log);
      expect(text).toContain("Searching for translation files matching: x/**/t.json");
      expect(text).toContain("Generated 7 translations from 3 file(s)");
      expect(text).toContain("/abs/out.ts");
      expect(text).toMatch(/Time:\S* \d+ms/);
      expect(exit).toHaveBeenCalledWith(0);
      expect(error).not.toHaveBeenCalled();
    });

    it("prints each error and exits 2 when there are validation errors", async () => {
      mockGenerate.mockResolvedValue(
        successResult({
          success: false,
          errors: [
            { file: "a.json", message: "Invalid", type: "validation" },
            { file: "b.json", message: "Boom", type: "file_system" },
          ],
        })
      );
      await run();
      const text = output(error);
      expect(text).toContain("Generation failed with errors:");
      expect(text).toContain("validation:");
      expect(text).toContain("a.json");
      expect(text).toContain("Invalid");
      expect(text).toContain("file_system:");
      expect(text).toContain("b.json");
      expect(text).toContain("Boom");
      expect(exit).toHaveBeenCalledWith(2);
    });

    it("exits 2 for missing language errors", async () => {
      mockGenerate.mockResolvedValue(
        successResult({
          success: false,
          errors: [{ file: "a.json", message: "x", type: "missing_languages" }],
        })
      );
      await run();
      expect(exit).toHaveBeenCalledWith(2);
    });

    it("exits 1 when only non validation errors occurred", async () => {
      mockGenerate.mockResolvedValue(
        successResult({
          success: false,
          errors: [
            { file: "a.json", message: "bad", type: "invalid_json" },
            { file: "b.json", message: "disk", type: "file_system" },
          ],
        })
      );
      await run();
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe("unexpected failures", () => {
    it("prints the message and stack of an Error and exits 1", async () => {
      const failure = new Error("generator exploded");
      mockGenerate.mockRejectedValue(failure);
      await run();
      const text = output(error);
      expect(text).toContain("generator exploded");
      expect(text).toContain("Stack trace:");
      expect(text).toContain(String(failure.stack));
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("omits the stack trace for an Error without a stack", async () => {
      const failure = new Error("no stack here");
      failure.stack = undefined;
      mockGenerate.mockRejectedValue(failure);
      await run();
      expect(output(error)).not.toContain("Stack trace:");
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("reports Unknown error occurred for a non Error rejection", async () => {
      mockGenerate.mockRejectedValue("weird");
      await run();
      const text = output(error);
      expect(text).toContain("Unknown error occurred");
      expect(text).not.toContain("Stack trace:");
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("reports config loading failures", async () => {
      mockLoadFromFile.mockRejectedValue(
        new Error("Invalid JSON in config file: Unexpected token")
      );
      await run();
      expect(output(error)).toContain(
        "Invalid JSON in config file: Unexpected token"
      );
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe("direct execution", () => {
    const originalWorkerId = process.env.JEST_WORKER_ID;

    afterEach(() => {
      process.env.JEST_WORKER_ID = originalWorkerId;
    });

    const loadAsEntry = async (argv1: string, ...args: string[]) => {
      delete process.env.JEST_WORKER_ID;
      process.argv = ["node", argv1, ...args];
      await jest.isolateModulesAsync(async () => {
        await import("@/cli/index");
      });
      for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
      }
    };

    it("runs main when the entry path contains cli/index", async () => {
      await loadAsEntry("/work/dist/cli/index.js", "--pattern", "z/**/t.json");
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: "z/**/t.json" })
      );
    });

    it("runs main when the entry path contains vbss-translator", async () => {
      await loadAsEntry("/usr/lib/node_modules/vbss-translator/bin/run.js");
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("does not run main for an unrelated entry path", async () => {
      await loadAsEntry("/work/other/script.js");
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("does not run main without an entry path", async () => {
      delete process.env.JEST_WORKER_ID;
      process.argv = ["node"];
      await jest.isolateModulesAsync(async () => {
        await import("@/cli/index");
      });
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("never runs main under jest", async () => {
      process.argv = ["node", "/work/dist/cli/index.js"];
      await jest.isolateModulesAsync(async () => {
        await import("@/cli/index");
      });
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("reports a fatal error and exits 1 when main itself rejects", async () => {
      exit.mockImplementationOnce((() => {
        throw new Error("exit blew up");
      }) as never);
      await loadAsEntry("/work/dist/cli/index.js", "--help");
      expect(output(error)).toContain("Fatal error: exit blew up");
      expect(exit).toHaveBeenLastCalledWith(1);
    });

    it("reports a fatal error for a non Error rejection", async () => {
      exit.mockImplementationOnce((() => {
        throw "string failure";
      }) as never);
      await loadAsEntry("/work/dist/cli/index.js", "--help");
      expect(output(error)).toContain("Fatal error: Unknown error occurred");
      expect(exit).toHaveBeenLastCalledWith(1);
    });
  });
});
