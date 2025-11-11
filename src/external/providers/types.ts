import type {
  ProviderAvailability,
  ProviderError,
  ProviderId,
  TranslateRequest,
  TranslateResult,
} from "@/types";

export type TranslationProviderTranslateOptions = {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
};

export interface TranslationProvider {
  readonly type: ProviderId;
  translate(
    request: TranslateRequest,
    options?: TranslationProviderTranslateOptions
  ): Promise<TranslateResult>;
  isAvailable?(): ProviderAvailability;
  normalizeError?(error: unknown): ProviderError;
}
