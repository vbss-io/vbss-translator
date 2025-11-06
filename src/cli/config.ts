import { readFile } from "fs/promises";
import { resolve } from "path";
import type { Config, ConfigLoader, OutputFormat } from "./types";

const DEFAULT_PATTERN = "src/**/translations.json";
const DEFAULT_OUTPUT_PATH = "src/translations/index.ts";
const DEFAULT_OUTPUT_FORMAT: OutputFormat = "ts";

class ConfigLoaderImpl implements ConfigLoader {
  async loadFromFile(path: string): Promise<Config | null> {
    try {
      const configPath = resolve(path);
      const fileContent = await readFile(configPath, "utf-8");
      const config = JSON.parse(fileContent) as Config;
      return config;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in config file: ${error.message}`);
      }
      throw error;
    }
  }

  loadFromArgs(args: Record<string, unknown>): Config {
    const config: Config = {};
    if (typeof args.pattern === "string") {
      config.pattern = args.pattern;
    }
    if (typeof args.output === "string") {
      config.outputPath = args.output;
    }
    if (
      typeof args.format === "string" &&
      (args.format === "ts" || args.format === "js" || args.format === "tsx")
    ) {
      config.outputFormat = args.format;
    }
    if (typeof args["reference-language"] === "string") {
      config.referenceLanguage = args["reference-language"];
    }
    return config;
  }

  merge(config: Config, overrides: Config): Config {
    const merged: Config = {
      ...config,
      ...overrides,
    };
    return {
      pattern: merged.pattern ?? DEFAULT_PATTERN,
      outputPath: merged.outputPath ?? DEFAULT_OUTPUT_PATH,
      outputFormat: merged.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      referenceLanguage: merged.referenceLanguage,
    };
  }
}

export const configLoader: ConfigLoader = new ConfigLoaderImpl();
