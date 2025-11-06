import { watch, existsSync } from "fs";
import { glob } from "glob";
import { dirname, resolve, relative, normalize } from "path";
import { generate } from "./generator";
import type { WatchService, WatchEvent, GeneratorOptions } from "./types";

const DEBOUNCE_DELAY = 300;

/**
 * Check if a file path matches a glob pattern
 * Uses a simplified approach: checks if the relative path matches the pattern
 */
function matchesPattern(
  filePath: string,
  pattern: string,
  cwd: string
): boolean {
  try {
    const normalizedFilePath = normalize(filePath);
    const normalizedCwd = normalize(cwd);
    let relativePath: string;
    try {
      relativePath = relative(normalizedCwd, normalizedFilePath);
    } catch {
      relativePath = relative(cwd, filePath);
    }
    relativePath = relativePath.replace(/\\/g, "/");
    let regexPattern = pattern.replace(/\\/g, "/");
    regexPattern = regexPattern.replace(/\*\*\//g, "___GLOB_DOUBLE_STAR_SLASH___");
    regexPattern = regexPattern.replace(/\*\*/g, "___GLOB_DOUBLE_STAR___");
    regexPattern = regexPattern.replace(/\./g, "\\.");
    regexPattern = regexPattern.replace(/\*/g, "[^/]*");
    regexPattern = regexPattern.replace(/\?/g, "[^/]");
    regexPattern = regexPattern.replace(/___GLOB_DOUBLE_STAR_SLASH___/g, "(.*/)?");
    regexPattern = regexPattern.replace(/___GLOB_DOUBLE_STAR___/g, ".*");
    const regex = new RegExp(`^${regexPattern}$`);
    const matches = regex.test(relativePath);
    console.log(`[DEBUG] Pattern matching: "${relativePath}" against "${regexPattern}" = ${matches}`);
    return matches;
  } catch (error) {
    console.log(`[DEBUG] Pattern matching failed, using fallback:`, error);
    const relativePath = relative(cwd, filePath).replace(/\\/g, "/");
    const pathParts = relativePath.split("/");
    const matches = 
      pathParts[pathParts.length - 1] === "translations.json" &&
      pathParts[0] === "src";
    console.log(`[DEBUG] Fallback pattern matching: "${relativePath}" = ${matches}`);
    return matches;
  }
}

/**
 * Get unique directories from file paths
 */
function getUniqueDirectories(filePaths: string[]): string[] {
  const dirs = new Set<string>();
  for (const filePath of filePaths) {
    dirs.add(dirname(filePath));
  }
  return Array.from(dirs);
}

/**
 * WatchService implementation using Node.js fs.watch
 */
class WatchServiceImpl implements WatchService {
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private isWatching = false;
  private generatorOptions: GeneratorOptions | null = null;
  private callback: ((event: WatchEvent) => void) | null = null;
  private pattern: string = "";
  private cwd: string = "";
  async watch(
    pattern: string,
    callback: (event: WatchEvent) => void
  ): Promise<void> {
    if (this.isWatching) {
      throw new Error("Watch service is already watching");
    }
    this.pattern = pattern;
    this.callback = callback;
    this.cwd = normalize(process.cwd());
    this.isWatching = true;
    const files = await glob(pattern, { cwd: this.cwd, absolute: true });
    const directories = getUniqueDirectories(files);
    if (directories.length === 0) {
      directories.push(this.cwd);
    }
    const normalizedDirs = directories.map((dir) => normalize(dir));
    console.log(`[DEBUG] Watching ${normalizedDirs.length} directory(ies) for pattern: ${pattern}`);
    for (const dir of normalizedDirs) {
      console.log(`[DEBUG] Setting up watch for directory: ${dir}`);
      this.watchDirectory(dir);
    }
    const normalizedCwd = normalize(this.cwd);
    if (!this.watchers.has(normalizedCwd)) {
      console.log(`[DEBUG] Setting up watch for root directory: ${normalizedCwd}`);
      this.watchDirectory(normalizedCwd);
    }
    console.log(`[DEBUG] Total watchers active: ${this.watchers.size}`);
  }

  private watchDirectory(dir: string): void {
    const normalizedDir = normalize(dir);
    if (this.watchers.has(normalizedDir)) {
      console.log(`[DEBUG] Already watching directory: ${normalizedDir}`);
      return;
    }
    console.log(`[DEBUG] Starting watch on directory: ${normalizedDir}`);
    const watcher = watch(normalizedDir, { recursive: true }, (eventType, filename) => {
      if (!filename) {
        console.log(`[DEBUG] Event received but filename is empty, eventType: ${eventType}`);
        return;
      }
      console.log(`[DEBUG] File system event: ${eventType} on ${filename} in ${normalizedDir}`);
      let filePath: string;
      try {
        filePath = resolve(normalizedDir, filename);
        filePath = normalize(filePath);
      } catch {
        filePath = normalize(filename);
      }
      console.log(`[DEBUG] Resolved file path: ${filePath}`);
      console.log(`[DEBUG] Pattern: ${this.pattern}, CWD: ${this.cwd}`);
      const matches = matchesPattern(filePath, this.pattern, this.cwd);
      console.log(`[DEBUG] Pattern match result: ${matches}`);
      if (!matches) {
        console.log(`[DEBUG] File does not match pattern, ignoring: ${filePath}`);
        return;
      }
      console.log(`[DEBUG] File matches pattern! Processing event...`);
      let eventTypeNormalized: "add" | "change" | "delete";
      if (eventType === "rename") {
        const fileExists = existsSync(filePath);
        eventTypeNormalized = fileExists ? "add" : "delete";
        console.log(`[DEBUG] Rename event, file exists: ${fileExists}, normalized to: ${eventTypeNormalized}`);
      } else if (eventType === "change") {
        eventTypeNormalized = "change";
        console.log(`[DEBUG] Change event detected`);
      } else {
        eventTypeNormalized = "change";
        console.log(`[DEBUG] Unknown event type: ${eventType}, defaulting to change`);
      }
      if (eventTypeNormalized === "add") {
        const fileDir = dirname(filePath);
        const normalizedFileDir = normalize(fileDir);
        if (!this.watchers.has(normalizedFileDir) && normalizedFileDir !== normalizedDir) {
          console.log(`[DEBUG] New file detected, ensuring directory is watched: ${normalizedFileDir}`);
          this.watchDirectory(normalizedFileDir);
        }
      }
      console.log(`[DEBUG] Triggering regeneration for: ${filePath} (${eventTypeNormalized})`);
      this.debounceRegeneration(filePath, eventTypeNormalized);
    });
    this.watchers.set(normalizedDir, watcher);
    watcher.on("error", (error) => {
      console.error(`[DEBUG] Watch error in ${normalizedDir}:`, error);
    });
    console.log(`[DEBUG] Watch successfully set up for: ${normalizedDir}`);
  }

  private debounceRegeneration(
    filePath: string,
    eventType: "add" | "change" | "delete"
  ): void {
    console.log(`[DEBUG] debounceRegeneration called for: ${filePath} (${eventType})`);
    if (this.debounceTimer) {
      console.log(`[DEBUG] Clearing existing debounce timer`);
      clearTimeout(this.debounceTimer);
    }
    console.log(`[DEBUG] Setting new debounce timer (${DEBOUNCE_DELAY}ms)`);
    this.debounceTimer = setTimeout(async () => {
      console.log(`[DEBUG] Debounce timer fired, starting regeneration...`);
      if (!this.generatorOptions || !this.callback) {
        console.log(`[DEBUG] Missing generatorOptions or callback, aborting regeneration`);
        return;
      }
      try {
        console.log(`[DEBUG] Calling generate with options:`, {
          pattern: this.generatorOptions.pattern,
          outputPath: this.generatorOptions.outputPath,
          outputFormat: this.generatorOptions.outputFormat,
        });
        const result = await generate(this.generatorOptions);
        const actualEventType: "add" | "change" | "delete" = eventType;
        if (this.callback) {
          this.callback({
            type: actualEventType,
            file: filePath,
          });
        }
        if (result.success) {
          console.log(
            `✅ Regenerated translations (${result.translationsGenerated} translations from ${result.filesFound} file(s))`
          );
        } else {
          console.error(
            `❌ Regeneration failed: ${result.errors
              .map((e) => e.message)
              .join(", ")}`
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`❌ Watch regeneration error: ${errorMessage}`);
      }
    }, DEBOUNCE_DELAY);
  }

  /**
   * Set generator options for regeneration
   */
  setGeneratorOptions(options: GeneratorOptions): void {
    this.generatorOptions = options;
  }

  stop(): void {
    if (!this.isWatching) {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const [, watcher] of this.watchers.entries()) {
      watcher.close();
    }
    this.watchers.clear();
    this.isWatching = false;
    this.generatorOptions = null;
    this.callback = null;
  }
}

/**
 * Create and start watching with generator integration
 */
export async function startWatch(options: GeneratorOptions): Promise<void> {
  const watchService = new WatchServiceImpl();
  watchService.setGeneratorOptions(options);
  console.log("🔍 Watching for translation file changes...");
  const initialResult = await generate(options);
  if (initialResult.success) {
    console.log(
      `✅ Initial generation: ${initialResult.translationsGenerated} translations from ${initialResult.filesFound} file(s)`
    );
  } else {
    console.error(
      `❌ Initial generation failed: ${initialResult.errors
        .map((e) => e.message)
        .join(", ")}`
    );
  }
  await watchService.watch(options.pattern, () => {});
  const cleanup = (): void => {
    console.log("\n👋 Stopping watch mode...");
    watchService.stop();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  return new Promise(() => {});
}

export { WatchServiceImpl };
export type { WatchService };
