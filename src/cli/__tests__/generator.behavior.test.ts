import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { readFile, writeFile, mkdir } from "fs/promises";
import { findFiles } from "@/cli/discover";
import { generate } from "@/cli/generator";
import type { GeneratorOptions, OutputFormat } from "@/cli/types";

jest.mock("fs/promises");
jest.mock("@/cli/discover");

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockFindFiles = findFiles as jest.MockedFunction<typeof findFiles>;

const options: GeneratorOptions = {
  pattern: "src/**/translations.json",
  outputPath: "src/translations/index.ts",
  outputFormat: "ts",
};

const filesWith = (...contents: unknown[]) => {
  const names = contents.map((_, index) => `src/f${index}/translations.json`);
  mockFindFiles.mockResolvedValueOnce(names);
  for (const content of contents) {
    mockReadFile.mockResolvedValueOnce(
      typeof content === "string" ? content : JSON.stringify(content)
    );
  }
};

const written = () => mockWriteFile.mock.calls[0][1] as string;

describe("generate behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("input validation", () => {
    it("rejects array items that are not objects", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }, null]);
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        expect.objectContaining({
          type: "validation",
          message: "Translation array must contain objects only",
        }),
      ]);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("rejects array items that are primitives", async () => {
      filesWith([5]);
      const result = await generate(options);
      expect(result.errors[0].message).toBe(
        "Translation array must contain objects only"
      );
    });

    it("rejects non string values inside array items with the key and type", async () => {
      filesWith([{ en: "Hi", pt: 3 }]);
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          type: "validation",
          message: 'Translation value for key "pt" must be a string, got number',
        })
      );
    });

    it("rejects non string values in a single object with the key and type", async () => {
      filesWith({ en: "Hi", pt: { nested: true } });
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toBe(
        'Translation value for key "pt" must be a string, got object'
      );
    });

    it.each([["a string", '"just text"'], ["a number", "12"], ["null", "null"]])(
      "rejects a file whose root is %s",
      async (_label, content) => {
        filesWith(content);
        const result = await generate(options);
        expect(result.success).toBe(false);
        expect(result.errors[0]).toEqual(
          expect.objectContaining({
            type: "validation",
            message:
              "Translation file must contain a JSON object or array of objects",
          })
        );
      }
    );

    it("reports invalid JSON with the parser message", async () => {
      filesWith("{ not json");
      const result = await generate(options);
      expect(result.errors[0].type).toBe("invalid_json");
      expect(result.errors[0].message).toMatch(/^Invalid JSON: /);
    });

    it("reports read failures as file system errors with the cause", async () => {
      mockFindFiles.mockResolvedValueOnce(["src/a/translations.json"]);
      mockReadFile.mockRejectedValueOnce(new Error("EACCES"));
      const result = await generate(options);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          type: "file_system",
          message: "Failed to read file: EACCES",
        })
      );
    });

    it("reports Unknown error for a non Error read failure", async () => {
      mockFindFiles.mockResolvedValueOnce(["src/a/translations.json"]);
      mockReadFile.mockRejectedValueOnce("weird");
      const result = await generate(options);
      expect(result.errors[0].message).toBe("Failed to read file: Unknown error");
    });

    it("reports discovery failures with the pattern", async () => {
      mockFindFiles.mockRejectedValueOnce(new Error("bad pattern"));
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toEqual({
        file: options.pattern,
        message: "Failed to discover files: bad pattern",
        type: "file_system",
      });
    });

    it("reports a discovery failure exactly once", async () => {
      mockFindFiles.mockRejectedValueOnce(new Error("bad pattern"));
      const result = await generate(options);
      expect(result.errors).toEqual([
        {
          file: options.pattern,
          message: "Failed to discover files: bad pattern",
          type: "file_system",
        },
      ]);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("reports Unknown error for a non Error discovery failure", async () => {
      mockFindFiles.mockRejectedValueOnce("boom");
      const result = await generate(options);
      expect(result.errors[0].message).toBe(
        "Failed to discover files: Unknown error"
      );
    });
  });

  describe("language consistency", () => {
    it("skips files that already failed while validating the valid ones", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }], "{ broken");
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.filesFound).toBe(2);
      expect(result.translationsGenerated).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe("invalid_json");
    });

    it("reports a file with no translations next to valid files", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }], []);
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.translationsGenerated).toBe(0);
      expect(result.errors).toEqual([
        expect.objectContaining({
          type: "validation",
          message: "File has no translations",
        }),
      ]);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("reports missing languages", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }], [{ en: "Bye" }]);
      const result = await generate(options);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          type: "missing_languages",
          message:
            "Language mismatch: missing languages: pt. Expected: en, pt",
        })
      );
    });

    it("reports extra languages", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }], [{ en: "Bye", pt: "Tchau", es: "Adios" }]);
      const result = await generate(options);
      expect(result.errors[0].message).toBe(
        "Language mismatch: extra languages: es. Expected: en, pt"
      );
    });

    it("reports missing and extra languages together", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }], [{ en: "Bye", es: "Adios" }]);
      const result = await generate(options);
      expect(result.errors[0].message).toBe(
        "Language mismatch: missing languages: pt, extra languages: es. Expected: en, pt"
      );
    });

    it("reports a translation inside a file with different keys than its first one", async () => {
      filesWith([
        { en: "Hi", pt: "Oi" },
        { en: "Bye", es: "Adios" },
      ]);
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toBe(
        "Translation 2 in file has different language keys"
      );
    });

    it("accepts the same languages in a different key order", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }], [{ pt: "Tchau", en: "Bye" }]);
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.translationsGenerated).toBe(2);
    });
  });

  describe("deduplication", () => {
    it("keeps entries that lack the reference language", async () => {
      filesWith([
        { en: "Hi", pt: "Oi" },
        { en: "Hi", pt: "Ola" },
      ]);
      const result = await generate({ ...options, referenceLanguage: "es" });
      expect(result.translationsGenerated).toBe(2);
    });

    it("deduplicates by the first language when no reference language is given", async () => {
      filesWith([
        { en: "Hi", pt: "Oi" },
        { en: "Hi", pt: "Ola" },
        { en: "Bye", pt: "Tchau" },
      ]);
      const result = await generate(options);
      expect(result.translationsGenerated).toBe(2);
    });

    it("deduplicates by the explicit reference language", async () => {
      filesWith([
        { en: "Hi", pt: "Oi" },
        { en: "Hello", pt: "Oi" },
      ]);
      const result = await generate({ ...options, referenceLanguage: "pt" });
      expect(result.translationsGenerated).toBe(1);
    });
  });

  describe("output", () => {
    it("generates an interface without language fields for an empty object file", async () => {
      filesWith({});
      const result = await generate(options);
      expect(result.success).toBe(true);
      expect(result.translationsGenerated).toBe(1);
      expect(written()).toMatch(
        /export interface Translation \{\s+\[key: string\]: string;\s+\}/
      );
    });

    it("inlines the translation data for js output", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }]);
      const result = await generate({ ...options, outputFormat: "js" });
      expect(result.success).toBe(true);
      const code = written();
      expect(code).not.toContain("import ");
      expect(code).toContain('"en": "Hi"');
      expect(code).toContain('"pt": "Oi"');
      expect(code).toContain("t.en === translation.en");
      expect(code).toContain("export default uniqueTranslations;");
    });

    it("inlines a single object file as one entry for js output", async () => {
      filesWith({ en: "Hi", pt: "Oi" }, [{ en: "Bye", pt: "Tchau" }]);
      await generate({ ...options, outputFormat: "js" });
      const code = written();
      expect(code.match(/"en":/g)).toHaveLength(2);
      expect(code.indexOf('"Hi"')).toBeLessThan(code.indexOf('"Bye"'));
    });

    it("orders imports by path and spreads single objects safely for ts output", async () => {
      mockFindFiles.mockResolvedValueOnce([
        "src/b/translations.json",
        "src/a/translations.json",
      ]);
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify({ en: "B", pt: "B" }))
        .mockResolvedValueOnce(JSON.stringify([{ en: "A", pt: "A" }]));
      await generate({ ...options, outputPath: "src/translations/index.ts" });
      const code = written();
      expect(code.indexOf("../a/translations.json")).toBeLessThan(
        code.indexOf("../b/translations.json")
      );
      expect(code).toContain("...translations0,");
      expect(code).toContain(
        "...(Array.isArray(translations1) ? translations1 : [translations1])"
      );
    });

    it("creates the output directory before writing", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }]);
      await generate({ ...options, outputPath: "out/deep/index.ts" });
      expect(mockMkdir).toHaveBeenCalledWith("out/deep", { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        "out/deep/index.ts",
        expect.any(String),
        "utf-8"
      );
    });

    it("fails with the cause when writing the output fails", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }]);
      mockWriteFile.mockRejectedValueOnce(new Error("ENOSPC"));
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.translationsGenerated).toBe(1);
      expect(result.errors).toEqual([
        {
          file: options.outputPath,
          message: "Failed to write output file: ENOSPC",
          type: "file_system",
        },
      ]);
    });

    it("reports Unknown error when writing fails with a non Error", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }]);
      mockWriteFile.mockRejectedValueOnce("full");
      const result = await generate(options);
      expect(result.errors[0].message).toBe(
        "Failed to write output file: Unknown error"
      );
    });

    it("rejects an unsupported output format without writing", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }]);
      const result = await generate({
        ...options,
        outputFormat: "json" as unknown as OutputFormat,
      });
      expect(result.success).toBe(false);
      expect(result.translationsGenerated).toBe(0);
      expect(result.errors).toEqual([
        {
          file: options.outputPath,
          message: "Unsupported output format: json",
          type: "validation",
        },
      ]);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("fails with a no valid files message when nothing could be parsed and no errors exist", async () => {
      filesWith([]);
      const result = await generate(options);
      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        {
          file: options.pattern,
          message: "No valid translation files found",
          type: "validation",
        },
      ]);
    });
  });

  describe("slow generation warning", () => {
    it("warns when generation takes more than one second for a small project", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }]);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const now = jest.spyOn(Date, "now");
      now.mockReturnValueOnce(1_000).mockReturnValue(3_500);
      await generate(options);
      expect(warn).toHaveBeenCalledWith(
        "⚠️  Generation took 2500ms for 1 files"
      );
    });

    it("does not warn when generation is fast", async () => {
      filesWith([{ en: "Hi", pt: "Oi" }]);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      await generate(options);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
