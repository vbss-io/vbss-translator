import axios, { type AxiosError, type AxiosInstance } from "axios";
import type {
  ProviderAvailability,
  ProviderConfig,
  ProviderError,
  TranslateRequest,
  TranslateResult,
} from "@/types";
import type {
  TranslationProvider,
  TranslationProviderTranslateOptions,
} from "@/external/providers/types";

type GoogleTranslateResponse = {
  data?: {
    translations?: Array<{
      translatedText?: string;
      detectedSourceLanguage?: string;
      model?: string;
    }>;
  };
};

const DEFAULT_ENDPOINT =
  "https://translation.googleapis.com/language/translate/v2";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const toBoolean = (value: unknown): boolean => Boolean(value);

const isAxiosError = <T = unknown>(error: unknown): error is AxiosError<T> => {
  return axios.isAxiosError(error);
};

export class GoogleTranslateProvider implements TranslationProvider {
  public readonly type = "google";

  private readonly axios: AxiosInstance;

  constructor(private readonly config: ProviderConfig) {
    this.axios = axios.create({
      baseURL: config.endpoint ?? DEFAULT_ENDPOINT,
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
    });
  }

  public isAvailable(): ProviderAvailability {
    if (this.config.apiKey || toBoolean(this.config.headers)) {
      return { available: true };
    }

    return {
      available: true,
    };
  }

  public async translate(
    request: TranslateRequest,
    options?: TranslationProviderTranslateOptions
  ): Promise<TranslateResult> {
    const payload: Record<string, unknown> = {
      q: request.text,
      target: request.targetLanguage,
      format: "text",
    };

    if (request.sourceLanguage && request.sourceLanguage !== "auto") {
      payload.source = request.sourceLanguage;
    }

    if (request.glossary && Object.keys(request.glossary).length > 0) {
      payload.glossaryConfig = {
        glossaryData: {
          languagePair: {
            sourceLanguageCode: request.sourceLanguage ?? "auto",
            targetLanguageCode: request.targetLanguage,
          },
          terms: Object.entries(request.glossary).map(([source, target]) => ({
            sourceText: source,
            targetText: target,
          })),
        },
      };
    }

    const headers = {
      ...this.config.headers,
      ...options?.headers,
    };

    const response = await this.axios.post<GoogleTranslateResponse>(
      "",
      payload,
      {
        headers,
        params: this.createQueryParams(),
        timeout: options?.timeoutMs,
        signal: options?.signal,
      }
    );

    const translation = response.data?.data?.translations?.[0];

    if (!translation?.translatedText) {
      throw new Error(
        "Google Translate response did not include translatedText"
      );
    }

    const providerMetadata: Record<string, string> = {
      endpoint: this.config.endpoint ?? DEFAULT_ENDPOINT,
    };

    if (translation.model) {
      providerMetadata.model = translation.model;
    }

    if (this.config.projectId) {
      providerMetadata.projectId = this.config.projectId;
    }

    if (this.config.region) {
      providerMetadata.region = this.config.region;
    }

    return {
      translatedText: translation.translatedText,
      detectedSourceLanguage: translation.detectedSourceLanguage,
      providerMetadata,
    };
  }

  public normalizeError(error: unknown): ProviderError {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      const data = (error.response?.data ?? {}) as {
        error?: { code?: string | number; message?: string };
      };

      const message =
        data.error?.message ??
        error.message ??
        "Google Translate request failed";

      return {
        code: String(data.error?.code ?? status ?? "E_GOOGLE"),
        message,
        retryable: status ? RETRYABLE_STATUS.has(status) : false,
        details: {
          status,
          data,
          headers: error.response?.headers,
        },
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

  private createQueryParams(): Record<string, string | undefined> | undefined {
    if (!this.config.apiKey) {
      return undefined;
    }

    return {
      key: this.config.apiKey,
    };
  }
}
