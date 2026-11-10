import { TranslationCache } from "@/external/cache/TranslationCache";
import type { TranslateResult } from "@/types";

const result = (text: string): TranslateResult => ({ translatedText: text });

const createCache = (
  overrides: Partial<ConstructorParameters<typeof TranslationCache>[0]> = {}
) => new TranslationCache({ enabled: true, ttlMs: 1_000, ...overrides });

describe("TranslationCache behavior", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("configuration", () => {
    it("reports the enabled flag given at construction", () => {
      expect(createCache({ enabled: true }).isEnabled()).toBe(true);
      expect(createCache({ enabled: false }).isEnabled()).toBe(false);
    });

    it("clears stored entries when disabled", () => {
      const cache = createCache();
      cache.set("a", result("A"));
      cache.setEnabled(false);
      expect(cache.isEnabled()).toBe(false);
      cache.setEnabled(true);
      expect(cache.size()).toBe(0);
      expect(cache.get("a")).toBeUndefined();
    });

    it("keeps stored entries when enabling again without disabling first", () => {
      const cache = createCache();
      cache.set("a", result("A"));
      cache.setEnabled(true);
      expect(cache.get("a")).toEqual(result("A"));
    });

    it("applies a new ttl only to entries written afterwards", () => {
      const cache = createCache({ ttlMs: 1_000 });
      cache.set("old", result("old"));
      cache.setTtl(5_000);
      cache.set("new", result("new"));
      jest.advanceTimersByTime(1_500);
      expect(cache.get("old")).toBeUndefined();
      expect(cache.get("new")).toEqual(result("new"));
    });

    it("never expires entries when ttl is zero", () => {
      const cache = createCache({ ttlMs: 0 });
      cache.set("forever", result("x"));
      jest.advanceTimersByTime(10 * 365 * 24 * 3_600_000);
      expect(cache.get("forever")).toEqual(result("x"));
    });

    it("treats a negative configured ttl as no expiry", () => {
      const cache = createCache({ ttlMs: -50 });
      cache.set("k", result("x"));
      jest.advanceTimersByTime(60_000);
      expect(cache.get("k")).toEqual(result("x"));
    });

    it("treats a negative ttl set later as no expiry", () => {
      const cache = createCache();
      cache.setTtl(-10);
      cache.set("k", result("x"));
      jest.advanceTimersByTime(60_000);
      expect(cache.has("k")).toBe(true);
    });
  });

  describe("ttl override", () => {
    it("uses a positive override instead of the default ttl", () => {
      const cache = createCache({ ttlMs: 10_000 });
      cache.set("short", result("s"), 100);
      jest.advanceTimersByTime(101);
      expect(cache.get("short")).toBeUndefined();
    });

    it("falls back to the default ttl for zero, negative and NaN overrides", () => {
      const cache = createCache({ ttlMs: 1_000 });
      cache.set("zero", result("z"), 0);
      cache.set("negative", result("n"), -5);
      cache.set("nan", result("x"), Number.NaN);
      jest.advanceTimersByTime(999);
      expect(cache.size()).toBe(3);
      jest.advanceTimersByTime(2);
      expect(cache.get("zero")).toBeUndefined();
      expect(cache.get("negative")).toBeUndefined();
      expect(cache.get("nan")).toBeUndefined();
    });

    it("rejects an infinite override and uses the default ttl", () => {
      const cache = createCache({ ttlMs: 1_000 });
      cache.set("infinite", result("i"), Number.POSITIVE_INFINITY);
      jest.advanceTimersByTime(1_001);
      expect(cache.get("infinite")).toBeUndefined();
    });
  });

  describe("get and has", () => {
    it("returns undefined for unknown keys", () => {
      const cache = createCache();
      expect(cache.get("missing")).toBeUndefined();
      expect(cache.has("missing")).toBe(false);
    });

    it("returns undefined and false while disabled", () => {
      const cache = createCache();
      cache.set("a", result("A"));
      cache.setEnabled(false);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.has("a")).toBe(false);
    });

    it("removes an expired entry when read", () => {
      const cache = createCache();
      cache.set("a", result("A"));
      jest.advanceTimersByTime(1_000);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it("reports presence for live entries and removes expired ones in has", () => {
      const cache = createCache();
      cache.set("a", result("A"));
      expect(cache.has("a")).toBe(true);
      jest.advanceTimersByTime(1_000);
      expect(cache.has("a")).toBe(false);
      expect(cache.size()).toBe(0);
    });
  });

  describe("delete and clear", () => {
    it("deletes a single key", () => {
      const cache = createCache();
      cache.set("a", result("A"));
      cache.set("b", result("B"));
      cache.delete("a");
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toEqual(result("B"));
    });

    it("clears every key", () => {
      const cache = createCache();
      cache.set("a", result("A"));
      cache.set("b", result("B"));
      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe("entries and prune", () => {
    it("lists live entries with result and expiry timestamp", () => {
      const cache = createCache({ ttlMs: 1_000 });
      cache.set("a", result("A"));
      expect(cache.entries()).toEqual([
        { key: "a", result: result("A"), expiresAt: Date.now() + 1_000 },
      ]);
    });

    it("lists entries without expiry when ttl is zero", () => {
      const cache = createCache({ ttlMs: 0 });
      cache.set("a", result("A"));
      expect(cache.entries()).toEqual([
        { key: "a", result: result("A"), expiresAt: undefined },
      ]);
    });

    it("drops expired entries while listing", () => {
      const cache = createCache({ ttlMs: 1_000 });
      cache.set("old", result("old"));
      jest.advanceTimersByTime(600);
      cache.set("fresh", result("fresh"));
      jest.advanceTimersByTime(500);
      expect(cache.entries().map((entry) => entry.key)).toEqual(["fresh"]);
      expect(cache.size()).toBe(1);
    });

    it("prunes only expired entries", () => {
      const cache = createCache({ ttlMs: 1_000 });
      cache.set("old", result("old"));
      jest.advanceTimersByTime(600);
      cache.set("fresh", result("fresh"));
      jest.advanceTimersByTime(500);
      cache.prune();
      expect(cache.size()).toBe(1);
      expect(cache.get("fresh")).toEqual(result("fresh"));
    });
  });

  describe("maxEntries", () => {
    it("evicts the entry inserted first when the limit is exceeded", () => {
      const cache = createCache({ maxEntries: 2, ttlMs: 0 });
      cache.set("a", result("A"));
      jest.advanceTimersByTime(1);
      cache.set("b", result("B"));
      jest.advanceTimersByTime(1);
      cache.set("c", result("C"));
      expect(cache.size()).toBe(2);
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
    });

    it("does not limit the store when maxEntries is not positive", () => {
      const cache = createCache({ maxEntries: 0, ttlMs: 0 });
      cache.set("a", result("A"));
      cache.set("b", result("B"));
      cache.set("c", result("C"));
      expect(cache.size()).toBe(3);
    });

    it("does not limit the store when maxEntries is omitted", () => {
      const cache = createCache({ ttlMs: 0 });
      for (let index = 0; index < 50; index++) {
        cache.set(`k${index}`, result(String(index)));
      }
      expect(cache.size()).toBe(50);
    });
  });

  it("ignores writes while disabled", () => {
    const cache = createCache({ enabled: false });
    cache.set("a", result("A"));
    expect(cache.size()).toBe(0);
  });
});
