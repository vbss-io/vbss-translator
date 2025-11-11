import type { CacheConfig, TranslateResult } from "@/types";
import type {
  TranslationCacheKey,
  TranslationCacheLike,
  TranslationCacheRecord,
} from "@/external/types";

type CacheEntry = {
  value: TranslateResult;
  expiresAt?: number;
  insertedAt: number;
};

const getNow = () => Date.now();

const isPositiveNumber = (value: number | undefined): value is number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
};

export class TranslationCache implements TranslationCacheLike {
  private readonly store = new Map<TranslationCacheKey, CacheEntry>();
  private enabled: boolean;
  private ttlMs: number;
  private readonly maxEntries?: number;

  constructor(config: CacheConfig) {
    this.enabled = config.enabled;
    this.ttlMs = Math.max(0, config.ttlMs);
    this.maxEntries = config.maxEntries;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.clear();
    }
    this.enabled = enabled;
  }

  public setTtl(ttlMs: number): void {
    this.ttlMs = Math.max(0, ttlMs);
  }

  public size(): number {
    return this.store.size;
  }

  public clear(): void {
    this.store.clear();
  }

  public get(key: TranslationCacheKey): TranslateResult | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  public set(
    key: TranslationCacheKey,
    value: TranslateResult,
    ttlOverride?: number
  ): void {
    if (!this.enabled) {
      return;
    }

    const ttlMs = isPositiveNumber(ttlOverride) ? ttlOverride : this.ttlMs;

    const expiresAt = isPositiveNumber(ttlMs) ? getNow() + ttlMs : undefined;

    this.store.set(key, {
      value,
      expiresAt,
      insertedAt: getNow(),
    });

    this.enforceMaxEntries();
  }

  public delete(key: TranslationCacheKey): void {
    this.store.delete(key);
  }

  public has(key: TranslationCacheKey): boolean {
    if (!this.enabled) {
      return false;
    }

    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  public entries(): TranslationCacheRecord[] {
    const result: TranslationCacheRecord[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        continue;
      }

      result.push({
        key,
        result: entry.value,
        expiresAt: entry.expiresAt,
      });
    }

    return result;
  }

  public prune(): void {
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
      }
    }
  }

  private enforceMaxEntries(): void {
    if (!isPositiveNumber(this.maxEntries)) {
      return;
    }

    const max = this.maxEntries as number;
    while (this.store.size > max) {
      const oldestKey = this.findOldestKey();
      if (!oldestKey) {
        break;
      }
      this.store.delete(oldestKey);
    }
  }

  private findOldestKey(): TranslationCacheKey | undefined {
    let oldestKey: TranslationCacheKey | undefined;
    let oldestTimestamp = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.store.entries()) {
      if (entry.insertedAt < oldestTimestamp) {
        oldestKey = key;
        oldestTimestamp = entry.insertedAt;
      }
    }

    return oldestKey;
  }

  private isExpired(entry: CacheEntry): boolean {
    if (!isPositiveNumber(entry.expiresAt)) {
      return false;
    }

    return entry.expiresAt <= getNow();
  }
}
