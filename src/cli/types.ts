export type OutputFormat = "ts" | "js" | "tsx";

export type TranslationRecord = Record<string, string>;

export interface DiscoveredFile {
  path: string;
  relativePath: string;
  translations: TranslationRecord[];
  wasSingleObject?: boolean;
  error?: GenerationError;
}

export interface Config {
  pattern?: string;
  outputPath?: string;
  outputFormat?: OutputFormat;
  referenceLanguage?: string;
}

export interface GeneratorOptions {
  pattern: string;
  outputPath: string;
  outputFormat: OutputFormat;
  referenceLanguage?: string;
  watch?: boolean;
}

export interface GenerationError {
  file: string;
  message: string;
  type: "invalid_json" | "missing_languages" | "file_system" | "validation";
}

export interface GenerationResult {
  success: boolean;
  filesFound: number;
  translationsGenerated: number;
  errors: GenerationError[];
  outputPath: string;
}

export interface ConfigLoader {
  loadFromFile(path: string): Promise<Config | null>;
  loadFromArgs(args: Record<string, unknown>): Config;
  merge(config: Config, overrides: Config): Config;
}

export interface WatchEvent {
  type: "add" | "change" | "delete";
  file: string;
}

export interface WatchService {
  watch(pattern: string, callback: (event: WatchEvent) => void): Promise<void>;
  stop(): void;
}
