import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { watch } from "fs";
import { glob } from "glob";
import { resolve, dirname } from "path";
import { WatchServiceImpl } from "@/cli/watch";
import { generate } from "@/cli/generator";
import type { GeneratorOptions } from "@/cli/types";

jest.mock("fs");
jest.mock("glob");
jest.mock("@/cli/generator");

const mockWatch = watch as jest.MockedFunction<typeof watch>;
const mockGlob = glob as jest.MockedFunction<typeof glob>;
const mockGenerate = generate as jest.MockedFunction<typeof generate>;

describe("WatchService", () => {
  let watchService: WatchServiceImpl;
  let mockWatcher: {
    on: jest.Mock;
    close: jest.Mock;
  };

  const defaultOptions: GeneratorOptions = {
    pattern: "src/**/translations.json",
    outputPath: "src/translations/index.ts",
    outputFormat: "ts",
  };

  function findWatchCallback(
    filePath: string
  ): ((eventType: string, filename: string) => void) | undefined {
    const watchedDir = dirname(filePath);
    const watchCall = mockWatch.mock.calls.find(
      (call) => call[0] === watchedDir
    );
    if (!watchCall) return undefined;
    const callback = watchCall[watchCall.length - 1] as
      | ((eventType: string, filename: string) => void)
      | undefined;
    return typeof callback === "function" ? callback : undefined;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    watchService = new WatchServiceImpl();
    mockWatcher = {
      on: jest.fn(),
      close: jest.fn(),
    };
    mockWatch.mockReturnValue(
      mockWatcher as unknown as ReturnType<typeof watch>
    );
    mockGenerate.mockResolvedValue({
      success: true,
      filesFound: 1,
      translationsGenerated: 1,
      errors: [],
      outputPath: defaultOptions.outputPath,
    });
  });

  afterEach(() => {
    watchService.stop();
    jest.useRealTimers();
  });

  describe("File system event detection", () => {
    it("should detect file add events", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      await jest.runAllTimersAsync();
      await Promise.resolve();
      expect(mockGenerate).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it("should detect file change events", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      await jest.runAllTimersAsync();
      await Promise.resolve();
      expect(mockGenerate).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it("should detect file delete events via rename", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("rename", "translations.json");
      await jest.runAllTimersAsync();
      await Promise.resolve();
      expect(mockGenerate).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe("Debouncing mechanism", () => {
    it("should debounce rapid file changes", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(100);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(100);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(100);
      expect(mockGenerate).not.toHaveBeenCalled();
      await jest.runAllTimersAsync();
      await Promise.resolve();
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it("should reset debounce timer on new events", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(200);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(200);
      expect(mockGenerate).not.toHaveBeenCalled();
      await jest.runAllTimersAsync();
      await Promise.resolve();
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  describe("Pattern matching", () => {
    it("should only trigger on files matching the pattern", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "other-file.json");
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it("should trigger on files matching the pattern", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      expect(mockGenerate).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it("should handle nested directory patterns", async () => {
      const absolutePaths = [
        resolve(process.cwd(), "src/components/translations.json"),
        resolve(process.cwd(), "src/pages/translations.json"),
      ];
      mockGlob.mockResolvedValueOnce(absolutePaths);
      watchService.setGeneratorOptions({
        ...defaultOptions,
        pattern: "src/**/translations.json",
      });
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch("src/**/translations.json", callback);
      const watchCallback = findWatchCallback(absolutePaths[0]);
      watchCallback?.("change", "translations.json");
      await jest.runAllTimersAsync();
      await Promise.resolve();
      expect(mockGenerate).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe("Cleanup on stop", () => {
    it("should close all watchers on stop", async () => {
      mockGlob.mockResolvedValueOnce([
        "src/components/translations.json",
        "src/pages/translations.json",
      ]);
      watchService.setGeneratorOptions(defaultOptions);
      await watchService.watch(defaultOptions.pattern, jest.fn());
      expect(mockWatch).toHaveBeenCalled();
      watchService.stop();
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("should clear debounce timer on stop", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      watchService.stop();
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      expect(mockGenerate).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it("should handle multiple stop calls gracefully", () => {
      watchService.stop();
      watchService.stop();
      expect(mockWatcher.close).not.toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should handle watcher errors gracefully", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const callback = jest.fn();
      await watchService.watch(defaultOptions.pattern, callback);
      const errorHandler = mockWatcher.on.mock.calls.find(
        (call) => call[0] === "error"
      )?.[1] as unknown as (error: Error) => void;
      if (errorHandler) {
        errorHandler(new Error("Watch error"));
      }
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should handle generation errors gracefully", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      mockGenerate.mockResolvedValueOnce({
        success: false,
        filesFound: 1,
        translationsGenerated: 0,
        errors: [
          {
            file: "src/components/translations.json",
            message: "Invalid JSON",
            type: "invalid_json",
          },
        ],
        outputPath: defaultOptions.outputPath,
      });
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      jest.useRealTimers();
    });

    it("should handle generation promise rejection", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      mockGenerate.mockRejectedValueOnce(new Error("Generation failed"));
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const callback = jest.fn();
      jest.useFakeTimers();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchCallback = findWatchCallback(absolutePath);
      watchCallback?.("change", "translations.json");
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe("Multiple directories", () => {
    it("should watch multiple directories", async () => {
      mockGlob.mockResolvedValueOnce([
        "src/components/translations.json",
        "src/pages/translations.json",
        "src/utils/translations.json",
      ]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      await watchService.watch(defaultOptions.pattern, callback);
      expect(mockWatch).toHaveBeenCalled();
      expect(mockWatch.mock.calls.length).toBeGreaterThan(0);
    });

    it("should not create duplicate watchers for the same directory", async () => {
      mockGlob.mockResolvedValueOnce([
        "src/components/translations.json",
        "src/components/other.json",
      ]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      await watchService.watch(defaultOptions.pattern, callback);
      const watchedDirs = new Set(mockWatch.mock.calls.map((call) => call[0]));
      expect(watchedDirs.size).toBeLessThanOrEqual(mockWatch.mock.calls.length);
    });
  });

  describe("Initial state", () => {
    it("should not allow watching twice", async () => {
      const absolutePath = resolve(
        process.cwd(),
        "src/components/translations.json"
      );
      mockGlob.mockResolvedValueOnce([absolutePath]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      await watchService.watch(defaultOptions.pattern, callback);
      await expect(
        watchService.watch(defaultOptions.pattern, callback)
      ).rejects.toThrow("Watch service is already watching");
    });

    it("should handle empty file discovery", async () => {
      mockGlob.mockResolvedValueOnce([]);
      watchService.setGeneratorOptions(defaultOptions);
      const callback = jest.fn();
      await watchService.watch(defaultOptions.pattern, callback);
      expect(mockWatch).toHaveBeenCalled();
    });
  });
});
