import { glob } from "glob";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, relative, resolve, normalize } from "path";
import type {
  GeneratorOptions,
  GenerationResult,
  GenerationError,
  DiscoveredFile,
  TranslationRecord,
} from "./types";

/**
 * Discover translation files using glob pattern
 */
async function discoverTranslationFiles(
  pattern: string
): Promise<DiscoveredFile[]> {
  try {
    const files = await glob(pattern, { cwd: process.cwd(), absolute: false });
    const cwd = process.cwd();
    return files.map((file) => {
      const absolutePath = resolve(cwd, file);
      return {
        path: absolutePath,
        relativePath: normalize(file).replace(/\\/g, "/"),
        translations: [],
      };
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return [
      {
        path: "",
        relativePath: "",
        translations: [],
        error: {
          file: pattern,
          message: `Failed to discover files: ${errorMessage}`,
          type: "file_system" as const,
        },
      },
    ];
  }
}

/**
 * Read and parse translation files in parallel
 */
async function readTranslationFiles(
  files: DiscoveredFile[]
): Promise<DiscoveredFile[]> {
  const readPromises = files.map(async (file) => {
    if (file.error) {
      return file;
    }
    try {
      const content = await readFile(file.path, "utf-8");
      const parsed = JSON.parse(content) as unknown;
      const translationRecords: TranslationRecord[] = [];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item !== "object" || item === null) {
            return {
              ...file,
              translations: [],
              error: {
                file: file.path,
                message: "Translation array must contain objects only",
                type: "validation" as const,
              },
            };
          }
          const record: TranslationRecord = {};
          for (const [key, value] of Object.entries(item)) {
            if (typeof value !== "string") {
              return {
                ...file,
                translations: [],
                error: {
                  file: file.path,
                  message: `Translation value for key "${key}" must be a string, got ${typeof value}`,
                  type: "validation" as const,
                },
              };
            }
            record[key] = value;
          }
          translationRecords.push(record);
        }
      } else if (typeof parsed === "object" && parsed !== null) {
        const record: TranslationRecord = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== "string") {
            return {
              ...file,
              translations: [],
              error: {
                file: file.path,
                message: `Translation value for key "${key}" must be a string, got ${typeof value}`,
                type: "validation" as const,
              },
            };
          }
          record[key] = value;
        }
        translationRecords.push(record);
        return {
          ...file,
          translations: translationRecords,
          wasSingleObject: true,
        };
      } else {
        return {
          ...file,
          translations: [],
          error: {
            file: file.path,
            message:
              "Translation file must contain a JSON object or array of objects",
            type: "validation" as const,
          },
        };
      }
      return {
        ...file,
        translations: translationRecords,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        return {
          ...file,
          translations: [],
          error: {
            file: file.path,
            message: `Invalid JSON: ${error.message}`,
            type: "invalid_json" as const,
          },
        };
      }
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        ...file,
        translations: [],
        error: {
          file: file.path,
          message: `Failed to read file: ${errorMessage}`,
          type: "file_system" as const,
        },
      };
    }
  });
  return Promise.all(readPromises);
}

/**
 * Detect language keys from the first valid translation file
 */
function detectLanguages(files: DiscoveredFile[]): string[] | null {
  for (const file of files) {
    if (!file.error && file.translations.length > 0) {
      return Object.keys(file.translations[0]);
    }
  }
  return null;
}

/**
 * Validate that all translation files have consistent language keys
 */
function validateLanguageConsistency(
  files: DiscoveredFile[],
  expectedLanguages: string[]
): GenerationError[] {
  const errors: GenerationError[] = [];
  for (const file of files) {
    if (file.error) {
      continue;
    }
    if (file.translations.length === 0) {
      errors.push({
        file: file.path,
        message: "File has no translations",
        type: "validation" as const,
      });
      continue;
    }
    const firstTranslationLanguages = Object.keys(file.translations[0]);
    for (let i = 1; i < file.translations.length; i++) {
      const currentLanguages = Object.keys(file.translations[i]);
      if (
        JSON.stringify([...currentLanguages].sort()) !==
        JSON.stringify([...firstTranslationLanguages].sort())
      ) {
        errors.push({
          file: file.path,
          message: `Translation ${i + 1} in file has different language keys`,
          type: "validation" as const,
        });
        continue;
      }
    }
    const fileLanguages = [...firstTranslationLanguages].sort();
    const expectedLanguagesSorted = [...expectedLanguages].sort();
    const missingLanguages = expectedLanguagesSorted.filter(
      (lang) => !fileLanguages.includes(lang)
    );
    const extraLanguages = fileLanguages.filter(
      (lang) => !expectedLanguagesSorted.includes(lang)
    );
    if (missingLanguages.length > 0 || extraLanguages.length > 0) {
      const parts: string[] = [];
      if (missingLanguages.length > 0) {
        parts.push(`missing languages: ${missingLanguages.join(", ")}`);
      }
      if (extraLanguages.length > 0) {
        parts.push(`extra languages: ${extraLanguages.join(", ")}`);
      }
      errors.push({
        file: file.path,
        message: `Language mismatch: ${parts.join(
          ", "
        )}. Expected: ${expectedLanguages.join(", ")}`,
        type: "missing_languages" as const,
      });
    }
  }
  return errors;
}

/**
 * Deduplicate translations based on reference language value
 */
function deduplicateTranslations(
  translations: TranslationRecord[],
  referenceLanguage: string
): TranslationRecord[] {
  const seen = new Set<string>();
  const result: TranslationRecord[] = [];
  for (const translation of translations) {
    const referenceValue = translation[referenceLanguage];
    if (referenceValue === undefined) {
      result.push(translation);
      continue;
    }
    const key = referenceValue;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(translation);
    }
  }
  return result;
}

/**
 * Calculate relative path from output file to source file
 */
function calculateRelativePath(fromPath: string, toPath: string): string {
  const fromDir = dirname(fromPath);
  const toFile = toPath;
  let relativePath = relative(fromDir, toFile);
  relativePath = normalize(relativePath).replace(/\\/g, "/");
  if (!relativePath.startsWith(".")) {
    relativePath = "./" + relativePath;
  }
  return relativePath;
}

/**
 * Generate TypeScript code with imports, interfaces, and exports
 */
function generateTypeScriptCode(
  files: DiscoveredFile[],
  outputPath: string,
  languages: string[]
): string {
  const validFiles = files
    .filter((f) => !f.error && f.translations.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
  if (validFiles.length === 0) {
    return "export default []\n";
  }
  const imports = validFiles
    .map((file, index) => {
      const relativePath = calculateRelativePath(outputPath, file.path);
      return `import translations${index} from '${relativePath}' assert { type: 'json' };`;
    })
    .join("\n");
  const spreadArray = validFiles
    .map((file, index) => {
      if (file.wasSingleObject) {
        return `  ...(Array.isArray(translations${index}) ? translations${index} : [translations${index}])`;
      }
      return `  ...translations${index}`;
    })
    .join(",\n");
  const interfaceFields = languages
    .map((lang) => `  ${lang}: string;`)
    .join("\n");
  const interfaceDef = `export interface Translation {\n${interfaceFields}\n  [key: string]: string;\n}`;
  const referenceLanguage = languages[0] || "en";
  const deduplicationCode =
    validFiles.length > 0
      ? `\nconst uniqueTranslations = allTranslations.filter(\n  (translation, index, self) => index === self.findIndex((t) => t.${referenceLanguage} === translation.${referenceLanguage})\n);`
      : "";
  return `${imports}\n\n${interfaceDef}\n\nconst allTranslations: Translation[] = [\n${spreadArray}\n];${deduplicationCode}\n\nexport default uniqueTranslations;\n`;
}

/**
 * Generate JavaScript code (same as TS but without interface)
 * Inlines translation data to avoid import assertions
 */
function generateJavaScriptCode(
  files: DiscoveredFile[]
): string {
  const validFiles = files
    .filter((f) => !f.error && f.translations.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
  if (validFiles.length === 0) {
    return "export default []\n";
  }
  const allTranslationsData: TranslationRecord[] = [];
  for (const file of validFiles) {
    if (file.wasSingleObject && file.translations.length === 1) {
      allTranslationsData.push(file.translations[0]);
    } else {
      allTranslationsData.push(...file.translations);
    }
  }
  const firstLanguage = allTranslationsData.length > 0
    ? Object.keys(allTranslationsData[0])[0]
    : "en";
  const translationsArray = allTranslationsData
    .map((translation) => {
      const json = JSON.stringify(translation, null, 2);
      const indented = json
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
      return indented;
    })
    .join(",\n");
  const deduplicationCode = `\nconst uniqueTranslations = allTranslations.filter(\n  (translation, index, self) => index === self.findIndex((t) => t.${firstLanguage} === translation.${firstLanguage})\n);`;
  return `const allTranslations = [\n${translationsArray}\n];${deduplicationCode}\n\nexport default uniqueTranslations;\n`;
}

/**
 * Generate TSX code (same as TS)
 */
function generateTSXCode(
  files: DiscoveredFile[],
  outputPath: string,
  languages: string[]
): string {
  return generateTypeScriptCode(files, outputPath, languages);
}

/**
 * Main generator function that orchestrates the complete pipeline
 */
export async function generate(
  options: GeneratorOptions
): Promise<GenerationResult> {
  const errors: GenerationError[] = [];
  const startTime = Date.now();
  const discoveredFiles = await discoverTranslationFiles(options.pattern);
  if (discoveredFiles.length === 0) {
    return {
      success: true,
      filesFound: 0,
      translationsGenerated: 0,
      errors: [],
      outputPath: options.outputPath,
    };
  }
  for (const file of discoveredFiles) {
    if (file.error) {
      errors.push(file.error);
    }
  }
  const readFiles = await readTranslationFiles(discoveredFiles);
  for (const file of readFiles) {
    if (file.error) {
      errors.push(file.error);
    }
  }
  const languages = detectLanguages(readFiles);
  if (!languages || languages.length === 0) {
    const validFiles = readFiles.filter(
      (f) => !f.error && f.translations.length > 0
    );
    if (validFiles.length === 0) {
      return {
        success: false,
        filesFound: discoveredFiles.length,
        translationsGenerated: 0,
        errors:
          errors.length > 0
            ? errors
            : [
                {
                  file: options.pattern,
                  message: "No valid translation files found",
                  type: "validation" as const,
                },
              ],
        outputPath: options.outputPath,
      };
    }
  }
  if (languages && languages.length > 0) {
    const validationErrors = validateLanguageConsistency(readFiles, languages);
    errors.push(...validationErrors);
    if (validationErrors.length > 0) {
      return {
        success: false,
        filesFound: discoveredFiles.length,
        translationsGenerated: 0,
        errors,
        outputPath: options.outputPath,
      };
    }
  }
  const allTranslations: TranslationRecord[] = [];
  for (const file of readFiles) {
    if (!file.error && file.translations.length > 0) {
      allTranslations.push(...file.translations);
    }
  }
  const referenceLanguage = options.referenceLanguage || languages?.[0] || "en";
  const uniqueTranslations = deduplicateTranslations(
    allTranslations,
    referenceLanguage
  );
  let generatedCode: string;
  const validFiles = readFiles.filter(
    (f) => !f.error && f.translations.length > 0
  );
  switch (options.outputFormat) {
    case "ts":
      generatedCode = generateTypeScriptCode(
        validFiles,
        options.outputPath,
        languages || []
      );
      break;
    case "tsx":
      generatedCode = generateTSXCode(
        validFiles,
        options.outputPath,
        languages || []
      );
      break;
    case "js":
      generatedCode = generateJavaScriptCode(validFiles);
      break;
    default:
      return {
        success: false,
        filesFound: discoveredFiles.length,
        translationsGenerated: 0,
        errors: [
          ...errors,
          {
            file: options.outputPath,
            message: `Unsupported output format: ${options.outputFormat}`,
            type: "validation" as const,
          },
        ],
        outputPath: options.outputPath,
      };
  }
  try {
    const outputDir = dirname(options.outputPath);
    await mkdir(outputDir, { recursive: true });
    await writeFile(options.outputPath, generatedCode, "utf-8");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    errors.push({
      file: options.outputPath,
      message: `Failed to write output file: ${errorMessage}`,
      type: "file_system" as const,
    });
    return {
      success: false,
      filesFound: discoveredFiles.length,
      translationsGenerated: uniqueTranslations.length,
      errors,
      outputPath: options.outputPath,
    };
  }
  const generationTime = Date.now() - startTime;
  if (generationTime > 1000 && discoveredFiles.length < 100) {
    console.warn(
      `⚠️  Generation took ${generationTime}ms for ${discoveredFiles.length} files`
    );
  }
  return {
    success: errors.length === 0,
    filesFound: discoveredFiles.length,
    translationsGenerated: uniqueTranslations.length,
    errors,
    outputPath: options.outputPath,
  };
}
