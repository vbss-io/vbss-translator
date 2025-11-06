import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { readFile } from "fs/promises";
import { configLoader } from "@/cli/config";
import type { Config } from "@/cli/types";

jest.mock("fs/promises");

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

describe("ConfigLoader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loadFromFile", () => {
    it("should load valid config file successfully", async () => {
      const configContent = JSON.stringify({
        pattern: "src/**/*.json",
        outputPath: "src/output/index.ts",
        outputFormat: "ts",
        referenceLanguage: "en",
      });
      mockReadFile.mockResolvedValueOnce(configContent);
      const result = await configLoader.loadFromFile(
        "vbss-translator.config.json"
      );
      expect(result).toEqual({
        pattern: "src/**/*.json",
        outputPath: "src/output/index.ts",
        outputFormat: "ts",
        referenceLanguage: "en",
      });
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining("vbss-translator.config.json"),
        "utf-8"
      );
    });

    it("should return null when config file does not exist", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockReadFile.mockRejectedValueOnce(error);
      const result = await configLoader.loadFromFile("nonexistent.config.json");
      expect(result).toBeNull();
    });

    it("should throw error with clear message when JSON is invalid", async () => {
      mockReadFile.mockResolvedValueOnce("{ invalid json }");
      await expect(
        configLoader.loadFromFile("invalid.config.json")
      ).rejects.toThrow("Invalid JSON in config file");
    });

    it("should handle empty config file", async () => {
      mockReadFile.mockResolvedValueOnce("{}");
      const result = await configLoader.loadFromFile("empty.config.json");
      expect(result).toEqual({});
    });

    it("should handle partial config file", async () => {
      const configContent = JSON.stringify({
        pattern: "src/**/*.json",
      });
      mockReadFile.mockResolvedValueOnce(configContent);
      const result = await configLoader.loadFromFile("partial.config.json");
      expect(result).toEqual({
        pattern: "src/**/*.json",
      });
    });

    it("should throw original error for non-ENOENT file system errors", async () => {
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      mockReadFile.mockRejectedValueOnce(error);
      await expect(
        configLoader.loadFromFile("restricted.config.json")
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("loadFromArgs", () => {
    it("should parse all CLI arguments correctly", () => {
      const args = {
        pattern: "custom/**/*.json",
        output: "custom/output.ts",
        format: "js",
        "reference-language": "pt",
      };
      const result = configLoader.loadFromArgs(args);
      expect(result).toEqual({
        pattern: "custom/**/*.json",
        outputPath: "custom/output.ts",
        outputFormat: "js",
        referenceLanguage: "pt",
      });
    });

    it("should handle empty args object", () => {
      const result = configLoader.loadFromArgs({});
      expect(result).toEqual({});
    });

    it("should handle partial args", () => {
      const args = {
        pattern: "src/**/*.json",
      };
      const result = configLoader.loadFromArgs(args);
      expect(result).toEqual({
        pattern: "src/**/*.json",
      });
    });

    it("should ignore invalid format values", () => {
      const args = {
        format: "invalid",
      };
      const result = configLoader.loadFromArgs(args);
      expect(result).toEqual({});
    });

    it("should accept valid format values (ts, js, tsx)", () => {
      const formats = ["ts", "js", "tsx"] as const;
      formats.forEach((format) => {
        const args = { format };
        const result = configLoader.loadFromArgs(args);
        expect(result.outputFormat).toBe(format);
      });
    });

    it("should ignore non-string values", () => {
      const args = {
        pattern: 123,
        output: null,
        format: ["ts"],
        "reference-language": undefined,
      };
      const result = configLoader.loadFromArgs(args);
      expect(result).toEqual({});
    });
  });

  describe("merge", () => {
    it("should merge config file with CLI overrides, CLI taking precedence", () => {
      const fileConfig: Config = {
        pattern: "src/**/translations.json",
        outputPath: "src/translations/index.ts",
        outputFormat: "ts",
        referenceLanguage: "en",
      };
      const cliOverrides: Config = {
        outputPath: "custom/output.js",
        outputFormat: "js",
      };
      const result = configLoader.merge(fileConfig, cliOverrides);
      expect(result).toEqual({
        pattern: "src/**/translations.json",
        outputPath: "custom/output.js",
        outputFormat: "js",
        referenceLanguage: "en",
      });
    });

    it("should apply default values when config is empty", () => {
      const result = configLoader.merge({}, {});
      expect(result).toEqual({
        pattern: "src/**/translations.json",
        outputPath: "src/translations/index.ts",
        outputFormat: "ts",
      });
    });

    it("should apply default values for missing fields", () => {
      const fileConfig: Config = {
        referenceLanguage: "en",
      };
      const result = configLoader.merge(fileConfig, {});
      expect(result).toEqual({
        pattern: "src/**/translations.json",
        outputPath: "src/translations/index.ts",
        outputFormat: "ts",
        referenceLanguage: "en",
      });
    });

    it("should use CLI overrides over file config completely", () => {
      const fileConfig: Config = {
        pattern: "file-pattern",
        outputPath: "file-output.ts",
        outputFormat: "ts",
        referenceLanguage: "en",
      };
      const cliOverrides: Config = {
        pattern: "cli-pattern",
        outputPath: "cli-output.js",
        outputFormat: "js",
        referenceLanguage: "pt",
      };
      const result = configLoader.merge(fileConfig, cliOverrides);
      expect(result).toEqual({
        pattern: "cli-pattern",
        outputPath: "cli-output.js",
        outputFormat: "js",
        referenceLanguage: "pt",
      });
    });

    it("should preserve undefined referenceLanguage when not provided", () => {
      const result = configLoader.merge({}, {});
      expect(result.referenceLanguage).toBeUndefined();
    });

    it("should handle null file config", () => {
      const cliOverrides: Config = {
        pattern: "cli-pattern",
      };
      const result = configLoader.merge(
        null as unknown as Config,
        cliOverrides
      );
      expect(result).toEqual({
        pattern: "cli-pattern",
        outputPath: "src/translations/index.ts",
        outputFormat: "ts",
      });
    });
  });

  describe("Integration scenarios", () => {
    it("should handle complete workflow: load file, parse args, merge", async () => {
      const configContent = JSON.stringify({
        pattern: "src/**/translations.json",
        outputPath: "src/translations/index.ts",
        outputFormat: "ts",
      });
      mockReadFile.mockResolvedValueOnce(configContent);
      const fileConfig = await configLoader.loadFromFile(
        "vbss-translator.config.json"
      );
      const cliArgs = configLoader.loadFromArgs({
        output: "custom/output.js",
        format: "js",
      });
      const merged = configLoader.merge(fileConfig || {}, cliArgs);
      expect(merged).toEqual({
        pattern: "src/**/translations.json",
        outputPath: "custom/output.js",
        outputFormat: "js",
      });
    });

    it("should handle missing config file with CLI args only", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockReadFile.mockRejectedValueOnce(error);
      const fileConfig = await configLoader.loadFromFile(
        "nonexistent.config.json"
      );
      const cliArgs = configLoader.loadFromArgs({
        pattern: "cli-pattern",
        output: "cli-output.ts",
      });
      const merged = configLoader.merge(fileConfig || {}, cliArgs);
      expect(merged).toEqual({
        pattern: "cli-pattern",
        outputPath: "cli-output.ts",
        outputFormat: "ts",
      });
    });
  });
});
