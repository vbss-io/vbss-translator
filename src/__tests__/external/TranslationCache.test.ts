import { TranslationCache } from "@/external/cache/TranslationCache";
import type { TranslateResult } from "@/types";

const createResult = (value: string): TranslateResult => ({
  translatedText: value,
});

describe("TranslationCache", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns cached translation within TTL", () => {
    const cache = new TranslationCache({
      enabled: true,
      ttlMs: 1_000,
    });
    const key = "en|es|123";
    const value = createResult("hola");
    cache.set(key, value);
    expect(cache.get(key)).toEqual(value);
  });

  it("expires entries after TTL", () => {
    jest.useFakeTimers();
    const cache = new TranslationCache({
      enabled: true,
      ttlMs: 1_000,
    });
    const key = "en|es|expiring";
    const value = createResult("adiós");
    cache.set(key, value);
    jest.advanceTimersByTime(1_001);
    expect(cache.get(key)).toBeUndefined();
  });

  it("enforces maxEntries by evicting oldest items", () => {
    const cache = new TranslationCache({
      enabled: true,
      ttlMs: 10_000,
      maxEntries: 2,
    });
    cache.set("key-1", createResult("one"));
    cache.set("key-2", createResult("two"));
    cache.set("key-3", createResult("three"));
    expect(cache.get("key-1")).toBeUndefined();
    expect(cache.get("key-2")?.translatedText).toBe("two");
    expect(cache.get("key-3")?.translatedText).toBe("three");
  });

  it("disables caching when disabled", () => {
    const cache = new TranslationCache({
      enabled: false,
      ttlMs: 1_000,
    });
    cache.set("disabled", createResult("noop"));
    expect(cache.get("disabled")).toBeUndefined();
    expect(cache.size()).toBe(0);
    cache.setEnabled(true);
    cache.set("enabled", createResult("ready"));
    expect(cache.get("enabled")?.translatedText).toBe("ready");
  });
});
