import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { watch, existsSync } from "fs";
import { resolve } from "path";
import { findFiles } from "@/cli/discover";
import { generate } from "@/cli/generator";
import { WatchServiceImpl, startWatch } from "@/cli/watch";
import type { GenerationResult, GeneratorOptions } from "@/cli/types";

jest.mock("fs");
jest.mock("@/cli/discover", () => ({
  ...jest.requireActual<typeof import("@/cli/discover")>("@/cli/discover"),
  findFiles: jest.fn(),
}));
jest.mock("@/cli/generator");

const mockWatch = watch as jest.MockedFunction<typeof watch>;
const mockExists = existsSync as jest.MockedFunction<typeof existsSync>;
const mockFindFiles = findFiles as jest.MockedFunction<typeof findFiles>;
const mockGenerate = generate as jest.MockedFunction<typeof generate>;

type WatchListener = (eventType: string, filename: string) => void;

const options: GeneratorOptions = {
  pattern: "src/**/translations.json",
  outputPath: "src/translations/index.ts",
  outputFormat: "ts",
};

const success = (overrides: Partial<GenerationResult> = {}): GenerationResult => ({
  success: true,
  filesFound: 2,
  translationsGenerated: 5,
  errors: [],
  outputPath: options.outputPath,
  ...overrides,
});

const listeners = (): WatchListener[] =>
  mockWatch.mock.calls.map((call) => (call as unknown[])[2] as WatchListener);

describe("watch behavior", () => {
  let watcher: { on: jest.Mock; close: jest.Mock };
  let log: jest.SpiedFunction<typeof console.log>;
  let error: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    log = jest.spyOn(console, "log").mockImplementation(() => {});
    error = jest.spyOn(console, "error").mockImplementation(() => {});
    watcher = { on: jest.fn(), close: jest.fn() };
    mockWatch.mockReturnValue(watcher as unknown as ReturnType<typeof watch>);
    mockExists.mockReturnValue(true);
    mockFindFiles.mockResolvedValue([]);
    mockGenerate.mockResolvedValue(success());
  });

  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
    error.mockRestore();
  });

  const startedService = async (
    pattern = options.pattern,
    callback: Parameters<WatchServiceImpl["watch"]>[1] = () => {},
    configure = true
  ) => {
    const service = new WatchServiceImpl();
    if (configure) {
      service.setGeneratorOptions(options);
    }
    await service.watch(pattern, callback);
    return service;
  };

  describe("event handling", () => {
    it("ignores events without a filename", async () => {
      const callback = jest.fn();
      const service = await startedService(options.pattern, callback);
      listeners()[0]("change", "");
      await jest.advanceTimersByTimeAsync(1_000);
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      service.stop();
    });

    it("reports a change event for a matching file after the debounce delay", async () => {
      const callback = jest.fn();
      const service = await startedService(options.pattern, callback);
      listeners()[0]("change", "src/components/translations.json");
      await jest.advanceTimersByTimeAsync(299);
      expect(mockGenerate).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(mockGenerate).toHaveBeenCalledWith(options);
      expect(callback).toHaveBeenCalledWith({
        type: "change",
        file: resolve(process.cwd(), "src/components/translations.json"),
      });
      service.stop();
    });

    it("maps a rename of an existing file to add and watches its directory", async () => {
      mockExists.mockReturnValue(true);
      const callback = jest.fn();
      const service = await startedService(options.pattern, callback);
      const before = mockWatch.mock.calls.length;
      listeners()[0]("rename", "src/pages/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledWith({
        type: "add",
        file: resolve(process.cwd(), "src/pages/translations.json"),
      });
      expect(mockWatch.mock.calls.length).toBe(before + 1);
      expect(mockWatch.mock.calls[before][0]).toBe(
        resolve(process.cwd(), "src/pages")
      );
      service.stop();
    });

    it("does not watch the same directory twice for repeated adds", async () => {
      const service = await startedService();
      listeners()[0]("rename", "src/pages/translations.json");
      const afterFirst = mockWatch.mock.calls.length;
      listeners()[0]("rename", "src/pages/translations.json");
      expect(mockWatch.mock.calls.length).toBe(afterFirst);
      await jest.advanceTimersByTimeAsync(300);
      service.stop();
    });

    it("maps a rename of a missing file to delete without adding a watcher", async () => {
      mockExists.mockReturnValue(false);
      const callback = jest.fn();
      const service = await startedService(options.pattern, callback);
      const before = mockWatch.mock.calls.length;
      listeners()[0]("rename", "src/pages/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledWith({
        type: "delete",
        file: resolve(process.cwd(), "src/pages/translations.json"),
      });
      expect(mockWatch.mock.calls.length).toBe(before);
      service.stop();
    });

    it("treats an unknown event type as a change", async () => {
      const callback = jest.fn();
      const service = await startedService(options.pattern, callback);
      listeners()[0]("mystery", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: "change" })
      );
      service.stop();
    });

    it("coalesces a burst of events into one regeneration with the last event", async () => {
      const callback = jest.fn();
      const service = await startedService(options.pattern, callback);
      listeners()[0]("change", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(100);
      listeners()[0]("change", "src/b/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        type: "change",
        file: resolve(process.cwd(), "src/b/translations.json"),
      });
      service.stop();
    });

    it("ignores files that do not match the pattern", async () => {
      const service = await startedService();
      listeners()[0]("change", "src/components/other.json");
      await jest.advanceTimersByTimeAsync(1_000);
      expect(mockGenerate).not.toHaveBeenCalled();
      service.stop();
    });

    it("supports question mark and star wildcards", async () => {
      const callback = jest.fn();
      const service = await startedService("src/?/*.json", callback);
      listeners()[0]("change", "src/a/file.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledTimes(1);
      listeners()[0]("change", "src/ab/file.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledTimes(1);
      service.stop();
    });

    it("matches brace alternatives like discovery does", async () => {
      const callback = jest.fn();
      const service = await startedService("src/**/{a,b}.json", callback);
      listeners()[0]("change", "src/x/a.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledTimes(1);
      listeners()[0]("change", "src/b.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledTimes(2);
      listeners()[0]("change", "src/x/c.json");
      await jest.advanceTimersByTimeAsync(1_000);
      expect(callback).toHaveBeenCalledTimes(2);
      service.stop();
    });

    it("matches bracket classes like discovery does", async () => {
      const callback = jest.fn();
      const service = await startedService("src/**/[ab].json", callback);
      listeners()[0]("change", "src/x/a.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledTimes(1);
      listeners()[0]("change", "src/x/c.json");
      await jest.advanceTimersByTimeAsync(1_000);
      expect(callback).toHaveBeenCalledTimes(1);
      service.stop();
    });

    it("treats regular expression characters in the pattern literally", async () => {
      const callback = jest.fn();
      const service = await startedService("src/(**/translations.json", callback);
      listeners()[0]("change", "src/(x/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledTimes(1);
      listeners()[0]("change", "src/x/translations.json");
      await jest.advanceTimersByTimeAsync(1_000);
      expect(callback).toHaveBeenCalledTimes(1);
      service.stop();
    });

    it("matches an absolute pattern against the absolute path", async () => {
      const callback = jest.fn();
      const absolutePattern = `${resolve(process.cwd(), "src").split("\\").join("/")}/**/*.json`;
      const service = await startedService(absolutePattern, callback);
      listeners()[0]("change", "src/x/a.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(callback).toHaveBeenCalledTimes(1);
      listeners()[0]("change", "lib/x/a.json");
      await jest.advanceTimersByTimeAsync(1_000);
      expect(callback).toHaveBeenCalledTimes(1);
      service.stop();
    });
  });

  describe("debug output", () => {
    const debugCalls = (spy: jest.SpiedFunction<typeof console.log>) =>
      spy.mock.calls.filter((call) => String(call[0]).startsWith("[DEBUG]"));

    it("never prints debug traces while watching, handling events and regenerating", async () => {
      const service = await startedService();
      listeners()[0]("change", "src/a/translations.json");
      listeners()[0]("rename", "src/new/translations.json");
      listeners()[0]("change", "src/a/other.json");
      listeners()[0]("rename", "");
      await jest.advanceTimersByTimeAsync(1_000);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(debugCalls(log)).toEqual([]);
      expect(
        error.mock.calls.filter((call) => String(call[0]).startsWith("[DEBUG]"))
      ).toEqual([]);
      service.stop();
    });

    it("never prints debug traces when a watcher fails", async () => {
      const service = await startedService();
      const onError = watcher.on.mock.calls.find(
        (call) => call[0] === "error"
      )?.[1] as (reason: Error) => void;
      onError(new Error("EPERM"));
      expect(
        error.mock.calls.filter((call) => String(call[0]).startsWith("[DEBUG]"))
      ).toEqual([]);
      service.stop();
    });
  });

  describe("regeneration outcome", () => {
    it("logs the regenerated totals on success", async () => {
      const service = await startedService();
      listeners()[0]("change", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(log).toHaveBeenCalledWith(
        "✅ Regenerated translations (5 translations from 2 file(s))"
      );
      service.stop();
    });

    it("logs the joined error messages when regeneration fails", async () => {
      mockGenerate.mockResolvedValue(
        success({
          success: false,
          errors: [
            { file: "a.json", message: "bad json", type: "invalid_json" },
            { file: "b.json", message: "no pt", type: "missing_languages" },
          ],
        })
      );
      const service = await startedService();
      listeners()[0]("change", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(error).toHaveBeenCalledWith(
        "❌ Regeneration failed: bad json, no pt"
      );
      service.stop();
    });

    it("logs the message when generation throws an Error", async () => {
      mockGenerate.mockRejectedValue(new Error("disk full"));
      const service = await startedService();
      listeners()[0]("change", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(error).toHaveBeenCalledWith(
        "❌ Watch regeneration error: disk full"
      );
      service.stop();
    });

    it("logs Unknown error when generation throws a non Error", async () => {
      mockGenerate.mockRejectedValue("nope");
      const service = await startedService();
      listeners()[0]("change", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(error).toHaveBeenCalledWith(
        "❌ Watch regeneration error: Unknown error"
      );
      service.stop();
    });

    it("does nothing when the service has no generator options", async () => {
      const callback = jest.fn();
      const service = await startedService(options.pattern, callback, false);
      listeners()[0]("change", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      service.stop();
    });

    it("does not regenerate after the service stopped", async () => {
      const service = await startedService();
      listeners()[0]("change", "src/a/translations.json");
      service.stop();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  describe("watcher lifecycle", () => {
    it("watches the directories of discovered files plus the working directory", async () => {
      mockFindFiles.mockResolvedValue([
        resolve(process.cwd(), "src/a/translations.json"),
        resolve(process.cwd(), "src/a/translations.json"),
        resolve(process.cwd(), "src/b/translations.json"),
      ]);
      const service = await startedService();
      expect(mockFindFiles).toHaveBeenCalledWith(options.pattern, {
        cwd: process.cwd(),
        absolute: true,
      });
      expect(mockWatch.mock.calls.map((call) => call[0])).toEqual([
        resolve(process.cwd(), "src/a"),
        resolve(process.cwd(), "src/b"),
        process.cwd(),
      ]);
      expect(mockWatch.mock.calls.every((call) => (call[1] as unknown as { recursive: boolean }).recursive)).toBe(true);
      service.stop();
    });

    it("logs watcher errors", async () => {
      const service = await startedService();
      const onError = watcher.on.mock.calls.find(
        (call) => call[0] === "error"
      )?.[1] as (reason: Error) => void;
      const failure = new Error("EPERM");
      onError(failure);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Watch error in"),
        failure
      );
      service.stop();
    });

    it("rejects a second watch call while watching and allows it after stop", async () => {
      const service = await startedService();
      await expect(service.watch(options.pattern, () => {})).rejects.toThrow(
        "Watch service is already watching"
      );
      service.stop();
      await expect(
        service.watch(options.pattern, () => {})
      ).resolves.toBeUndefined();
      service.stop();
    });

    it("closes every watcher on stop", async () => {
      mockFindFiles.mockResolvedValue([
        resolve(process.cwd(), "src/a/translations.json"),
      ]);
      const service = await startedService();
      const created = mockWatch.mock.calls.length;
      service.stop();
      expect(watcher.close).toHaveBeenCalledTimes(created);
    });

    it("does nothing when stop is called before watching", () => {
      new WatchServiceImpl().stop();
      expect(watcher.close).not.toHaveBeenCalled();
    });
  });

  describe("startWatch", () => {
    let onSpy: jest.SpiedFunction<typeof process.on>;
    let exitSpy: jest.SpiedFunction<typeof process.exit>;

    beforeEach(() => {
      onSpy = jest.spyOn(process, "on").mockImplementation(() => process);
      exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);
    });

    afterEach(() => {
      onSpy.mockRestore();
      exitSpy.mockRestore();
    });

    const flush = async () => {
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    };

    it("generates once, logs the totals and starts watching", async () => {
      void startWatch(options);
      await flush();
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledWith(options);
      expect(log).toHaveBeenCalledWith(
        "🔍 Watching for translation file changes..."
      );
      expect(log).toHaveBeenCalledWith(
        "✅ Initial generation: 5 translations from 2 file(s)"
      );
      expect(mockFindFiles).toHaveBeenCalledWith(options.pattern, {
        cwd: process.cwd(),
        absolute: true,
      });
      expect(mockWatch).toHaveBeenCalled();
    });

    it("reports a failed initial generation and keeps watching", async () => {
      mockGenerate.mockResolvedValue(
        success({
          success: false,
          errors: [{ file: "a.json", message: "bad json", type: "invalid_json" }],
        })
      );
      void startWatch(options);
      await flush();
      expect(error).toHaveBeenCalledWith(
        "❌ Initial generation failed: bad json"
      );
      expect(mockWatch).toHaveBeenCalled();
    });

    it("registers SIGINT and SIGTERM handlers that stop watching and exit", async () => {
      void startWatch(options);
      await flush();
      const signals = onSpy.mock.calls.map((call) => call[0]);
      expect(signals).toEqual(["SIGINT", "SIGTERM"]);
      const handler = onSpy.mock.calls[0][1] as () => void;
      handler();
      expect(log).toHaveBeenCalledWith("\n👋 Stopping watch mode...");
      expect(watcher.close).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("regenerates when a watched file changes after startup", async () => {
      void startWatch(options);
      await flush();
      mockGenerate.mockClear();
      listeners()[0]("change", "src/a/translations.json");
      await jest.advanceTimersByTimeAsync(300);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledWith(options);
    });
  });
});
