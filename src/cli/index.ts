#!/usr/bin/env node

import { resolve } from "path";
import { generate } from "@/cli/generator";
import { configLoader } from "@/cli/config";
import { startWatch } from "@/cli/watch";
import type { Config, GeneratorOptions } from "@/cli/types";

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
} as const;

const EMOJI = {
  searching: "🔍",
  success: "✅",
  error: "❌",
  warning: "⚠️",
} as const;

interface ParsedArgs {
  [key: string]: string | boolean | undefined;
}

/**
 * Parse command line arguments from process.argv
 * Supports both --flag=value and --flag value syntax
 */
function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      const value = valueParts.join("=");
      parsed[key] = value || true;
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        parsed[key] = args[i + 1];
        i += 2;
      } else {
        parsed[key] = true;
        i++;
      }
      continue;
    }
    if (arg.startsWith("-") && !arg.startsWith("--")) {
      const key = arg.slice(1);
      parsed[key] = true;
      i++;
      continue;
    }
    i++;
  }
  return parsed;
}

/**
 * Display help message
 */
function showHelp(): void {
  const help = `
${COLORS.blue}vbss-translator generate${COLORS.reset}
Generate translation index files from translation JSON files.
${COLORS.yellow}Usage:${COLORS.reset}
  npx vbss-translator generate [options]
  npm run generate-translations [options]
${COLORS.yellow}Options:${COLORS.reset}
  --pattern <glob>           Glob pattern to search for translation files
                            (default: "src/**/translations.json")
  --output <path>            Output file path
                            (default: "src/translations/index.ts")
  --format <ts|js|tsx>       Output format (default: "ts")
  --watch, -w                Enable watch mode (runs continuously)
  --config <path>            Path to config file
                            (default: "vbss-translator.config.json")
  --reference-language <lang> Reference language for deduplication
  --help, -h                 Show this help message
${COLORS.yellow}Examples:${COLORS.reset}
  npx vbss-translator generate
  npx vbss-translator generate --pattern "src/**/*.json" --output "src/translations.ts"
  npx vbss-translator generate --format js --reference-language en
${COLORS.yellow}Configuration:${COLORS.reset}
  Create a "vbss-translator.config.json" file in your project root:
  {
    "pattern": "src/**/translations.json",
    "outputPath": "src/translations/index.ts",
    "outputFormat": "ts",
    "referenceLanguage": "en"
  }
  CLI flags take precedence over config file settings.
`;
  console.log(help);
}

/**
 * Format error message with color
 */
function formatError(message: string): string {
  return `${COLORS.red}${EMOJI.error} ${message}${COLORS.reset}`;
}

/**
 * Format success message with color
 */
function formatSuccess(message: string): string {
  return `${COLORS.green}${EMOJI.success} ${message}${COLORS.reset}`;
}

/**
 * Format info message with color
 */
function formatInfo(message: string): string {
  return `${COLORS.blue}${EMOJI.searching} ${message}${COLORS.reset}`;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help || parsedArgs.h) {
    showHelp();
    process.exit(0);
  }
  try {
    const configFilePath =
      typeof parsedArgs.config === "string"
        ? parsedArgs.config
        : "vbss-translator.config.json";
    const configPath = resolve(process.cwd(), configFilePath);
    const fileConfig = await configLoader.loadFromFile(configPath);
    const cliConfig: Config = configLoader.loadFromArgs({
      pattern: parsedArgs.pattern,
      output: parsedArgs.output,
      format: parsedArgs.format,
      "reference-language": parsedArgs["reference-language"],
    });
    const mergedConfig = configLoader.merge(fileConfig || {}, cliConfig);
    console.log(
      formatInfo(
        `Searching for translation files matching: ${mergedConfig.pattern}`
      )
    );
    const generatorOptions: GeneratorOptions = {
      pattern: mergedConfig.pattern!,
      outputPath: resolve(process.cwd(), mergedConfig.outputPath!),
      outputFormat: mergedConfig.outputFormat!,
      referenceLanguage: mergedConfig.referenceLanguage,
      watch: parsedArgs.watch === true || parsedArgs.w === true,
    };
    if (generatorOptions.watch) {
      await startWatch(generatorOptions);
      return;
    }
    const startTime = Date.now();
    const result = await generate(generatorOptions);
    const duration = Date.now() - startTime;
    if (result.success) {
      console.log(
        formatSuccess(
          `Generated ${result.translationsGenerated} translations from ${result.filesFound} file(s)`
        )
      );
      console.log(`${COLORS.green}Output:${COLORS.reset} ${result.outputPath}`);
      console.log(`${COLORS.green}Time:${COLORS.reset} ${duration}ms`);
      process.exit(0);
    } else {
      console.error(formatError("Generation failed with errors:"));
      for (const error of result.errors) {
        console.error(
          `${COLORS.red}  ${error.type}:${COLORS.reset} ${error.file}`
        );
        console.error(`  ${error.message}`);
      }
      const hasValidationErrors = result.errors.some(
        (e) => e.type === "validation" || e.type === "missing_languages"
      );
      process.exit(hasValidationErrors ? 2 : 1);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(formatError(errorMessage));
    if (error instanceof Error && error.stack) {
      console.error(`${COLORS.red}Stack trace:${COLORS.reset}`);
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (!process.env.JEST_WORKER_ID) {
  const isDirectExecution =
    process.argv[1] &&
    (process.argv[1].includes("cli/index") ||
      process.argv[1].includes("vbss-translator"));
  if (isDirectExecution) {
    main().catch((error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      console.error(formatError(`Fatal error: ${errorMessage}`));
      process.exit(1);
    });
  }
}

export { main };
