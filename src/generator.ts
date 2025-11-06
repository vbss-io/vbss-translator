/**
 * Programmatic API for vbss-translator generator
 * 
 * This module is Node.js only and should not be imported in browser environments.
 * Use this for build tool integrations (Vite plugins, Webpack loaders, etc.)
 * 
 * @example
 * ```typescript
 * import { generate } from 'vbss-translator/generator';
 * 
 * const result = await generate({
 *   pattern: 'src/**\/translations.json',
 *   outputPath: 'src/translations/index.ts',
 *   outputFormat: 'ts',
 * });
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
