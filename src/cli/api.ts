/**
 * Programmatic API for build tool integration
 *
 * This module exports the core generation functionality for use in build tool plugins
 * (Vite, Webpack, etc.). The API provides the same functionality as the CLI, but
 * can be called programmatically from build tool plugins.
 *
 * @example
 * ```typescript
 * import { generate } from 'vbss-translator';
 *
 * const result = await generate({
 *   pattern: 'src/**\/translations.json',
 *   outputPath: 'src/translations/index.ts',
 *   outputFormat: 'ts',
 *   referenceLanguage: 'en',
 * });
 *
 * if (result.success) {
 *   console.log('Generated', result.translationsGenerated, 'translations');
 * }
 * ```
 */

export { generate } from "@/cli/generator";
export type {
  GeneratorOptions,
  GenerationResult,
  GenerationError,
  OutputFormat,
  TranslationRecord,
} from "@/cli/types";
