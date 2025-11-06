import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { readFile, writeFile, mkdir } from "fs/promises";
import { glob } from "glob";
import { generate } from "@/cli/generator";
import type { GeneratorOptions } from "@/cli/types";

jest.mock("fs/promises");
jest.mock("glob");

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockGlob = glob as jest.MockedFunction<typeof glob>;

describe("Generator", () => {
  const defaultOptions: GeneratorOptions = {
    pattern: "src/**/translations.json",
    outputPath: "src/translations/index.ts",
    outputFormat: "ts",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Empty project", () => {
    it("should return success with zero files when no translation files found", async () => {
      mockGlob.mockResolvedValueOnce([]);
      const result = await generate(defaultOptions);
      expect(result).toEqual({
        success: true,
        filesFound: 0,
        translationsGenerated: 0,
        errors: [],
        outputPath: defaultOptions.outputPath,
      });
      expect(mockGlob).toHaveBeenCalledWith(defaultOptions.pattern, {
        cwd: process.cwd(),
        absolute: false,
      });
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe("Single translation file", () => {
    it("should generate index file from single translation file with array", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const result = await generate(defaultOptions);
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(1);
      expect(result.translationsGenerated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain(`import translations0 from`);
      expect(writtenContent).toContain("export interface Translation");
      expect(writtenContent).toContain("en: string");
      expect(writtenContent).toContain("pt: string");
      expect(writtenContent).toContain("export default uniqueTranslations");
    });

    it("should handle single translation file with single object", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ en: "Hello", pt: "Olá" })
      );
      const result = await generate(defaultOptions);
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(1);
      expect(result.translationsGenerated).toBe(1);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("Array.isArray(translations0)");
    });
  });

  describe("Multiple files with duplicates", () => {
    it("should deduplicate translations based on reference language", async () => {
      const file1 = "src/components/translations.json";
      const file2 = "src/pages/translations.json";
      mockGlob.mockResolvedValueOnce([file1, file2]);
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify([{ en: "Hello", pt: "Olá" }]))
        .mockResolvedValueOnce(
          JSON.stringify([
            { en: "Hello", pt: "Olá" },
            { en: "World", pt: "Mundo" },
          ])
        );
      const result = await generate({
        ...defaultOptions,
        referenceLanguage: "en",
      });
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(2);
      expect(result.translationsGenerated).toBe(2);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("uniqueTranslations");
      expect(writtenContent).toContain("t.en === translation.en");
    });

    it("should preserve first occurrence when duplicates found", async () => {
      const file1 = "src/components/translations.json";
      const file2 = "src/pages/translations.json";
      mockGlob.mockResolvedValueOnce([file1, file2]);
      mockReadFile
        .mockResolvedValueOnce(
          JSON.stringify([{ en: "Hello", pt: "Olá (first)" }])
        )
        .mockResolvedValueOnce(
          JSON.stringify([{ en: "Hello", pt: "Olá (second)" }])
        );
      const result = await generate({
        ...defaultOptions,
        referenceLanguage: "en",
      });
      expect(result.success).toBe(true);
      expect(result.translationsGenerated).toBe(1);
    });
  });

  describe("Language consistency validation", () => {
    it("should fail when files have inconsistent language keys", async () => {
      const file1 = "src/components/translations.json";
      const file2 = "src/pages/translations.json";
      mockGlob.mockResolvedValueOnce([file1, file2]);
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify([{ en: "Hello", pt: "Olá" }]))
        .mockResolvedValueOnce(JSON.stringify([{ en: "Hello", es: "Hola" }]));
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.type === "missing_languages")).toBe(
        true
      );
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("should detect languages from first valid file", async () => {
      const file1 = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([file1]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: "Olá", es: "Hola" }])
      );
      const result = await generate(defaultOptions);
      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("en: string");
      expect(writtenContent).toContain("pt: string");
      expect(writtenContent).toContain("es: string");
    });
  });

  describe("Malformed JSON handling", () => {
    it("should handle invalid JSON files with clear error messages", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce("{ invalid json }");
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.type === "invalid_json")).toBe(true);
      expect(result.errors[0].message).toContain("Invalid JSON");
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("should handle files with non-string values", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: 123 }])
      );
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === "validation")).toBe(true);
      expect(result.errors[0].message).toContain("must be a string");
    });

    it("should handle files with null or array at root level incorrectly", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce("null");
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === "validation")).toBe(true);
    });
  });

  describe("Nested directory structures", () => {
    it("should handle files in nested directories", async () => {
      const files = [
        "src/components/button/translations.json",
        "src/components/modal/translations.json",
        "src/pages/home/translations.json",
      ];
      mockGlob.mockResolvedValueOnce(files);
      mockReadFile.mockResolvedValue(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const result = await generate(defaultOptions);
      expect(result.success).toBe(true);
      expect(result.filesFound).toBe(3);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("import translations0 from");
      expect(writtenContent).toContain("import translations1 from");
      expect(writtenContent).toContain("import translations2 from");
    });
  });

  describe("Output formats", () => {
    it("should generate TypeScript code with interfaces", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const result = await generate({
        ...defaultOptions,
        outputFormat: "ts",
      });
      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("export interface Translation");
      expect(writtenContent).toContain(": Translation[]");
    });

    it("should generate JavaScript code without interfaces", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const result = await generate({
        ...defaultOptions,
        outputFormat: "js",
      });
      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).not.toContain("export interface");
      expect(writtenContent).toContain("const allTranslations = [");
    });

    it("should generate TSX code same as TypeScript", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const result = await generate({
        ...defaultOptions,
        outputFormat: "tsx",
      });
      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("export interface Translation");
    });
  });

  describe("Relative path calculation", () => {
    it("should calculate correct relative paths for imports", async () => {
      const files = [
        "src/components/translations.json",
        "src/pages/home/translations.json",
      ];
      mockGlob.mockResolvedValueOnce(files);
      mockReadFile.mockResolvedValue(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const result = await generate({
        ...defaultOptions,
        outputPath: "src/translations/index.ts",
      });
      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toMatch(
        /import translations0 from ['"]\.\.\/components\/translations\.json/
      );
    });

    it("should handle same directory imports", async () => {
      const files = ["src/translations/en.json"];
      mockGlob.mockResolvedValueOnce(files);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const result = await generate({
        ...defaultOptions,
        outputPath: "src/translations/index.ts",
      });
      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toMatch(
        /import translations0 from ['"]\.\/en\.json/
      );
    });
  });

  describe("File system error handling", () => {
    it("should handle file read errors gracefully", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      const readError = new Error("Permission denied") as NodeJS.ErrnoException;
      readError.code = "EACCES";
      mockReadFile.mockRejectedValueOnce(readError);
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === "file_system")).toBe(true);
      expect(result.errors[0].message).toContain("Failed to read file");
    });

    it("should handle directory creation errors", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([{ en: "Hello", pt: "Olá" }])
      );
      const mkdirError = new Error("Permission denied");
      mockMkdir.mockRejectedValueOnce(mkdirError);
      const result = await generate({
        ...defaultOptions,
        outputPath: "new/dir/index.ts",
      });
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === "file_system")).toBe(true);
      expect(result.errors[0].message).toContain("Failed to write output file");
    });

    it("should handle glob errors gracefully", async () => {
      const globError = new Error("Invalid pattern");
      mockGlob.mockRejectedValueOnce(globError);
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === "file_system")).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle files with multiple translations per file", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([
          { en: "Hello", pt: "Olá" },
          { en: "World", pt: "Mundo" },
          { en: "Goodbye", pt: "Adeus" },
        ])
      );
      const result = await generate(defaultOptions);
      expect(result.success).toBe(true);
      expect(result.translationsGenerated).toBe(3);
    });

    it("should use first language as reference if not specified", async () => {
      const file1 = "src/components/translations.json";
      const file2 = "src/pages/translations.json";
      mockGlob.mockResolvedValueOnce([file1, file2]);
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify([{ pt: "Olá", en: "Hello" }]))
        .mockResolvedValueOnce(JSON.stringify([{ pt: "Olá", en: "Hello" }]));
      const result = await generate({
        ...defaultOptions,
      });

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("t.pt === translation.pt");
    });

    it("should handle empty translation arrays", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(JSON.stringify([]));
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.type === "validation")).toBe(true);
    });
  });

  describe("Multiple translations validation within file", () => {
    it("should validate all translations in a file have same language keys", async () => {
      const translationFile = "src/components/translations.json";
      mockGlob.mockResolvedValueOnce([translationFile]);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify([
          { en: "Hello", pt: "Olá" },
          { en: "World", es: "Mundo" },
        ])
      );
      const result = await generate(defaultOptions);
      expect(result.success).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("different language keys"))
      ).toBe(true);
    });
  });
});
