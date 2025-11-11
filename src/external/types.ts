import type {
  ExternalTranslationConfig,
  ExternalTranslationRequest,
  ProviderError,
  TranslateRequest,
  TranslateResult,
} from "@/types";
import type { TranslationProvider } from "@/external/providers/types";

export type TranslationStatus = "idle" | "pending" | "resolved" | "error";

export type TranslationCacheKey = string;

export interface TranslationCacheRecord {
  readonly key: TranslationCacheKey;
  readonly result: TranslateResult;
  readonly expiresAt?: number;
}

export interface TranslationCacheLike {
  get(key: TranslationCacheKey): TranslateResult | undefined;
  set(key: TranslationCacheKey, value: TranslateResult, ttlMs?: number): void;
  delete(key: TranslationCacheKey): void;
  clear(): void;
  size(): number;
}

export interface ExternalTranslationLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
  debug?(message: string, context?: Record<string, unknown>): void;
}

export type ExternalTranslationManagerDependencies = {
  readonly provider: TranslationProvider;
  readonly config: ExternalTranslationConfig;
  readonly cache?: TranslationCacheLike;
  readonly logger?: ExternalTranslationLogger;
};

export type ExternalTranslationManagerRequest = ExternalTranslationRequest & {
  readonly glossary?: Record<string, string>;
  readonly preferExternal?: boolean;
  readonly fallbackValue?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type ExternalTranslationManagerResult = {
  readonly key: string;
  readonly request: TranslateRequest;
  readonly result: TranslateResult;
  readonly fromCache: boolean;
};

export type ExternalTranslationManagerError = {
  readonly key: string;
  readonly request: TranslateRequest;
  readonly error: ProviderError;
};
