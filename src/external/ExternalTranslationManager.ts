import type {
  ExternalTranslationManagerDependencies,
  ExternalTranslationManagerRequest,
} from "@/external/types";
import type {
  ExternalTranslationErrorEvent,
  ExternalTranslationRequest,
  ProviderError,
  TranslateRequest,
  TranslateResult,
} from "@/types";

type InFlightPromise = Promise<TranslateResult | undefined>;

type NormalizedRequest = {
  readonly externalRequest: ExternalTranslationRequest;
  readonly translateRequest: TranslateRequest;
  readonly cacheKey: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
};

class ExternalTranslationTimeoutError extends Error {
  public readonly code = "timeout";

  constructor(message: string) {
    super(message);
    this.name = "ExternalTranslationTimeoutError";
  }
}

const DEFAULT_SOURCE_LANGUAGE = "auto";

const isPositiveNumber = (value: number | undefined): value is number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
};

const sortObjectKeys = (
  input: Record<string, string>
): Record<string, string> => {
  const entries = Object.entries(input).sort(([a], [b]) => {
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  });

  return Object.fromEntries(entries);
};

export class ExternalTranslationManager {
  private readonly provider: ExternalTranslationManagerDependencies["provider"];
  private readonly config: ExternalTranslationManagerDependencies["config"];
  private readonly cache?: ExternalTranslationManagerDependencies["cache"];
  private readonly logger?: ExternalTranslationManagerDependencies["logger"];
  private readonly inFlight = new Map<string, InFlightPromise>();

  constructor(dependencies: ExternalTranslationManagerDependencies) {
    this.provider = dependencies.provider;
    this.config = dependencies.config;
    this.cache = dependencies.cache;
    this.logger = dependencies.logger;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public async translate(
    request: ExternalTranslationManagerRequest
  ): Promise<TranslateResult | undefined> {
    if (!this.isEnabled()) {
      this.debug("external_translation_disabled", {
        key: request.key,
        targetLanguage: request.targetLanguage,
      });
      return undefined;
    }

    const normalized = this.normalizeRequest(request);

    if (!(await this.shouldTranslate(normalized.externalRequest))) {
      this.debug("external_translation_skipped", {
        key: normalized.externalRequest.key,
        targetLanguage: normalized.externalRequest.targetLanguage,
      });
      return undefined;
    }

    const cached = this.readFromCache(normalized.cacheKey);
    if (cached) {
      this.debug("external_translation_cache_hit", {
        key: normalized.externalRequest.key,
        cacheKey: normalized.cacheKey,
      });
      return cached;
    }

    const existingPromise = this.inFlight.get(normalized.cacheKey);
    if (existingPromise) {
      this.debug("external_translation_deduped", {
        key: normalized.externalRequest.key,
        cacheKey: normalized.cacheKey,
      });
      return existingPromise;
    }

    const promise = this.executeTranslation(normalized);
    this.inFlight.set(normalized.cacheKey, promise);
    return promise;
  }

  private normalizeRequest(
    request: ExternalTranslationManagerRequest
  ): NormalizedRequest {
    const sourceLanguage = request.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;

    const translateRequest: TranslateRequest = {
      text: request.text,
      sourceLanguage,
      targetLanguage: request.targetLanguage,
      glossary: request.glossary,
    };

    const cacheKey = this.createCacheKey(translateRequest);

    const timeoutMs = isPositiveNumber(request.timeoutMs)
      ? request.timeoutMs
      : this.config.timeoutMs;

    const externalRequest: ExternalTranslationRequest = {
      key: request.key,
      text: request.text,
      targetLanguage: request.targetLanguage,
      sourceLanguage,
    };

    return {
      externalRequest,
      translateRequest,
      cacheKey,
      timeoutMs,
      signal: request.signal,
    };
  }

  private async shouldTranslate(
    request: ExternalTranslationRequest
  ): Promise<boolean> {
    if (!this.config.shouldTranslate) {
      return true;
    }

    try {
      return this.config.shouldTranslate(request);
    } catch (error) {
      this.warn("external_translation_should_translate_error", {
        key: request.key,
        language: request.targetLanguage,
        error,
      });
      return true;
    }
  }

  private async executeTranslation(
    normalized: NormalizedRequest
  ): Promise<TranslateResult | undefined> {
    try {
      if (
        !(await this.invokeExternalTranslationHook(normalized.externalRequest))
      ) {
        this.debug("external_translation_vetoed", {
          key: normalized.externalRequest.key,
          targetLanguage: normalized.externalRequest.targetLanguage,
        });
        return undefined;
      }

      this.debug("external_translation_started", {
        key: normalized.externalRequest.key,
        cacheKey: normalized.cacheKey,
      });

      const result = await this.translateWithTimeout(
        normalized.translateRequest,
        normalized.timeoutMs,
        normalized.signal
      );

      this.writeToCache(normalized.cacheKey, result);
      this.notifyTranslationComplete(result);
      this.debug("external_translation_succeeded", {
        key: normalized.externalRequest.key,
        cacheKey: normalized.cacheKey,
      });

      return result;
    } catch (error) {
      const providerError = this.normalizeError(error);
      this.handleTranslationError(normalized, providerError);
      return undefined;
    } finally {
      this.inFlight.delete(normalized.cacheKey);
    }
  }

  private async invokeExternalTranslationHook(
    request: ExternalTranslationRequest
  ): Promise<boolean> {
    const callback = this.config.onExternalTranslation;
    if (!callback) {
      return true;
    }

    try {
      const result = await callback(request);
      if (typeof result === "boolean") {
        return result;
      }
      return true;
    } catch (error) {
      this.warn("external_translation_hook_error", {
        key: request.key,
        language: request.targetLanguage,
        error,
      });
      return true;
    }
  }

  private async translateWithTimeout(
    request: TranslateRequest,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<TranslateResult> {
    const abortSupported = typeof AbortController === "function";

    if (!abortSupported) {
      return this.provider.translate(request, {
        timeoutMs: isPositiveNumber(timeoutMs) ? timeoutMs : undefined,
        signal,
      });
    }

    const controller = new AbortController();
    let timeoutTriggered = false;
    let abortHandler: (() => void) | undefined;

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        abortHandler = () => {
          controller.abort();
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    const timer =
      isPositiveNumber(timeoutMs) && timeoutMs
        ? setTimeout(() => {
            timeoutTriggered = true;
            controller.abort();
          }, timeoutMs)
        : undefined;

    try {
      return await this.provider.translate(request, {
        timeoutMs: isPositiveNumber(timeoutMs) ? timeoutMs : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (timeoutTriggered) {
        throw new ExternalTranslationTimeoutError(
          `External translation timed out after ${timeoutMs}ms`
        );
      }

      if (controller.signal.aborted && !timeoutTriggered) {
        throw error;
      }

      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (abortHandler && signal) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }

  private readFromCache(cacheKey: string): TranslateResult | undefined {
    return this.cache?.get(cacheKey);
  }

  private writeToCache(cacheKey: string, result: TranslateResult): void {
    this.cache?.set(cacheKey, result);
  }

  private handleTranslationError(
    normalized: NormalizedRequest,
    error: ProviderError
  ): void {
    const event: ExternalTranslationErrorEvent = {
      key: normalized.externalRequest.key,
      language: normalized.externalRequest.targetLanguage,
      originalText: normalized.externalRequest.text,
      error,
    };

    this.notifyTranslationError(event);

    this.warn("external_fallback_failed", {
      provider: this.provider.type,
      key: event.key,
      language: event.language,
      errorCode: error.code,
      retryable: error.retryable,
      message: error.message,
      details: error.details,
    });
  }

  private normalizeError(error: unknown): ProviderError {
    if (this.provider.normalizeError) {
      return this.provider.normalizeError(error);
    }

    if (error instanceof ExternalTranslationTimeoutError) {
      return {
        code: "timeout",
        message: error.message,
        retryable: true,
        details: error,
      };
    }

    if (error instanceof Error) {
      return {
        code: error.name || "unknown_error",
        message: error.message,
        retryable: false,
        details: error,
      };
    }

    return {
      code: "unknown_error",
      message: "Unknown provider error",
      retryable: false,
      details: error,
    };
  }

  private createCacheKey(request: TranslateRequest): string {
    const keyParts = [
      request.sourceLanguage,
      request.targetLanguage,
      this.hashText(request.text, request.glossary),
    ];

    return keyParts.join("|");
  }

  private hashText(
    text: string,
    glossary: Record<string, string> | undefined
  ): string {
    let hash = 2166136261;
    const combined =
      glossary && Object.keys(glossary).length > 0
        ? `${text}|${JSON.stringify(sortObjectKeys(glossary))}`
        : text;

    for (let index = 0; index < combined.length; index += 1) {
      hash ^= combined.charCodeAt(index);
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    return (hash >>> 0).toString(16);
  }

  private warn(event: string, context: Record<string, unknown>): void {
    const payload = {
      scope: "translator",
      event,
      ...context,
    };

    if (this.logger) {
      this.logger.warn(event, payload);
      return;
    }

    console.warn("[vbss-translator]", payload);
  }

  private debug(event: string, context: Record<string, unknown>): void {
    if (!this.config.debug) {
      return;
    }

    const payload = {
      scope: "translator",
      event,
      ...context,
    };

    if (this.logger?.debug) {
      this.logger.debug(event, payload);
      return;
    }

    console.debug("[vbss-translator]", payload);
  }

  private notifyTranslationComplete(result: TranslateResult): void {
    const callback = this.config.onTranslationComplete;
    if (!callback) {
      return;
    }

    try {
      callback(result);
    } catch (error) {
      this.warn("external_translation_complete_callback_error", {
        provider: this.provider.type,
        error,
      });
    }
  }

  private notifyTranslationError(event: ExternalTranslationErrorEvent): void {
    const callback = this.config.onTranslationError;
    if (!callback) {
      return;
    }

    try {
      callback(event);
    } catch (error) {
      this.warn("external_translation_error_callback_error", {
        provider: this.provider.type,
        key: event.key,
        language: event.language,
        error,
      });
    }
  }
}
