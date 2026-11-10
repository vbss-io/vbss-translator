import { watch, existsSync } from "fs";
import { findFiles, matchesGlob } from "./discover";
import { dirname, isAbsolute, resolve, relative, normalize } from "path";
import { generate } from "./generator";
import type { WatchService, WatchEvent, GeneratorOptions } from "./types";

const DEBOUNCE_DELAY = 300;

function matchesPattern(
  filePath: string,
  pattern: string,
  cwd: string
): boolean {
  const target = isAbsolute(pattern) ? filePath : relative(cwd, filePath);
  return matchesGlob(target, pattern);
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
    const files = await findFiles(pattern, {
      cwd: this.cwd,
      absolute: true,
    });
    const directories = getUniqueDirectories(files);
    if (directories.length === 0) {
      directories.push(this.cwd);
    }
    const normalizedDirs = directories.map((dir) => normalize(dir));
    for (const dir of normalizedDirs) {
      this.watchDirectory(dir);
    }
    const normalizedCwd = normalize(this.cwd);
    if (!this.watchers.has(normalizedCwd)) {
      this.watchDirectory(normalizedCwd);
    }
  }

  private watchDirectory(dir: string): void {
    const normalizedDir = normalize(dir);
    if (this.watchers.has(normalizedDir)) {
      return;
    }
    const watcher = watch(normalizedDir, { recursive: true }, (eventType, filename) => {
      if (!filename) {
        return;
      }
      let filePath: string;
      try {
        filePath = resolve(normalizedDir, filename);
        filePath = normalize(filePath);
      } catch {
        filePath = normalize(filename);
      }
      const matches = matchesPattern(filePath, this.pattern, this.cwd);
      if (!matches) {
        return;
      }
      let eventTypeNormalized: "add" | "change" | "delete";
      if (eventType === "rename") {
        const fileExists = existsSync(filePath);
        eventTypeNormalized = fileExists ? "add" : "delete";
      } else if (eventType === "change") {
        eventTypeNormalized = "change";
      } else {
        eventTypeNormalized = "change";
      }
      if (eventTypeNormalized === "add") {
        const fileDir = dirname(filePath);
        const normalizedFileDir = normalize(fileDir);
        if (!this.watchers.has(normalizedFileDir) && normalizedFileDir !== normalizedDir) {
          this.watchDirectory(normalizedFileDir);
        }
      }
      this.debounceRegeneration(filePath, eventTypeNormalized);
    });
    this.watchers.set(normalizedDir, watcher);
    watcher.on("error", (error) => {
      console.error(`❌ Watch error in ${normalizedDir}:`, error);
    });
  }

  private debounceRegeneration(
    filePath: string,
    eventType: "add" | "change" | "delete"
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      if (!this.generatorOptions || !this.callback) {
        return;
      }
      try {
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
