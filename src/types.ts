import type { ReactNode } from "react";

export type Translation = Record<string, string>;

export type ProviderId = "google";

export type ProviderConfig = {
  id: ProviderId;
  apiKey?: string;
  endpoint?: string;
  projectId?: string;
  region?: string;
  headers?: Record<string, string>;
};

export type ProviderError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
};

export type ProviderAvailability = {
  available: boolean;
  reason?: string;
};

export type TranslateRequest = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossary?: Record<string, string>;
};

export type TranslateResult = {
  translatedText: string;
  detectedSourceLanguage?: string;
  providerMetadata?: Record<string, string>;
};

export type TranslateOptions = {
  preferExternal?: boolean;
  sourceLanguage?: string;
  fallbackValue?: string;
  signal?: AbortSignal;
};

export type CacheConfig = {
  enabled: boolean;
  ttlMs: number;
  maxEntries?: number;
};

export type ExternalTranslationRequest = {
  key: string;
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
};

export type ExternalTranslationErrorEvent = {
  key: string;
  language: string;
  error: ProviderError;
  originalText: string;
};

export type ExternalTranslationCallbacks = {
  shouldTranslate?: (request: ExternalTranslationRequest) => boolean;
  onExternalTranslation?: (
    request: ExternalTranslationRequest
  ) => void | boolean | Promise<void | boolean>;
  onTranslationError?: (event: ExternalTranslationErrorEvent) => void;
  onTranslationComplete?: (result: TranslateResult) => void;
};

export type ExternalTranslationConfig = ExternalTranslationCallbacks & {
  enabled: boolean;
  provider: ProviderConfig;
  cache: CacheConfig;
  alwaysExternalKeys: ReadonlySet<string>;
  timeoutMs: number;
  debug?: boolean;
};

export type ExternalTranslationConfigInput = Partial<
  Omit<ExternalTranslationConfig, "alwaysExternalKeys">
> & {
  alwaysExternalKeys?: ReadonlyArray<string> | ReadonlySet<string>;
};

export type TranslatorProviderType = {
  children: ReactNode;
  translations: Translation[];
  defaultLanguage?: string;
  persist?: boolean;
  persistKey?: string;
  autoDetectLanguage?: boolean;
  externalTranslation?: ExternalTranslationConfigInput;
};

export type TranslatorContextType = {
  t: (key: string, options?: TranslateOptions) => string;
  language: string;
  languages: string[];
  setLanguage: (language: string) => void;
  isTranslating: Record<string, boolean>;
  isTranslatingAny: boolean;
  registerExternalKey: (key: string) => void;
  externalConfig: ExternalTranslationConfig;
};
