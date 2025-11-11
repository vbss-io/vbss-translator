import axios from "axios";
import type { AxiosInstance } from "axios";
import { GoogleTranslateProvider } from "@/external/providers/googleTranslateProvider";
import type { ProviderError, ProviderConfig } from "@/types";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

type PostMock = jest.MockedFunction<AxiosInstance["post"]>;

describe("GoogleTranslateProvider", () => {
  const createAxiosInstance = (implementation?: PostMock) => {
    const post: PostMock = implementation ?? (jest.fn() as PostMock);
    mockedAxios.create.mockReturnValue({
      post,
    } as unknown as AxiosInstance);
    return post;
  };

  const createProvider = (config?: Partial<ProviderConfig>) => {
    mockedAxios.create.mockClear();
    return new GoogleTranslateProvider({
      id: "google",
      ...config,
    });
  };

  beforeEach(() => {
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is never =>
        Boolean((error as { isAxiosError?: boolean })?.isAxiosError)
    );
    mockedAxios.create.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sends translation request with API key and headers", async () => {
    const axiosPostMock: PostMock = jest.fn().mockResolvedValue({
      data: {
        data: {
          translations: [
            {
              translatedText: "Hola",
              detectedSourceLanguage: "en",
              model: "nmt",
            },
          ],
        },
      },
    });
    const post = createAxiosInstance(axiosPostMock);
    const provider = createProvider({
      apiKey: "test-key",
      headers: {
        "X-Custom": "value",
      },
    });
    const result = await provider.translate({
      text: "Hello",
      sourceLanguage: "en",
      targetLanguage: "es",
    });
    expect(result.translatedText).toBe("Hola");
    expect(post).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        q: "Hello",
        source: "en",
        target: "es",
        format: "text",
      }),
      expect.objectContaining({
        params: { key: "test-key" },
        headers: expect.objectContaining({ "X-Custom": "value" }),
      })
    );
  });

  it("passes timeout and signal options to axios", async () => {
    const abortController = new AbortController();
    const axiosPostMock: PostMock = jest.fn().mockResolvedValue({
      data: {
        data: {
          translations: [
            {
              translatedText: "Hola",
            },
          ],
        },
      },
    });
    const post = createAxiosInstance(axiosPostMock);
    const provider = createProvider();
    await provider.translate(
      {
        text: "Hello",
        sourceLanguage: "auto",
        targetLanguage: "es",
      },
      {
        timeoutMs: 2500,
        signal: abortController.signal,
      }
    );
    expect(post).toHaveBeenCalledWith(
      "",
      expect.any(Object),
      expect.objectContaining({
        timeout: 2500,
        signal: abortController.signal,
      })
    );
  });

  it("includes glossary configuration when provided", async () => {
    const axiosPostMock: PostMock = jest.fn().mockResolvedValue({
      data: {
        data: {
          translations: [
            {
              translatedText: "Hola",
            },
          ],
        },
      },
    });
    const post = createAxiosInstance(axiosPostMock);
    const provider = createProvider();
    await provider.translate({
      text: "Hello",
      sourceLanguage: "en",
      targetLanguage: "es",
      glossary: {
        Hello: "Hola",
      },
    });
    expect(post).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        glossaryConfig: expect.objectContaining({
          glossaryData: expect.objectContaining({
            terms: [
              {
                sourceText: "Hello",
                targetText: "Hola",
              },
            ],
          }),
        }),
      }),
      expect.any(Object)
    );
  });

  it("throws when response does not include translated text", async () => {
    const axiosPostMock: PostMock = jest.fn().mockResolvedValue({ data: {} });
    createAxiosInstance(axiosPostMock);
    const provider = createProvider();
    await expect(
      provider.translate({
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "es",
      })
    ).rejects.toThrow(
      "Google Translate response did not include translatedText"
    );
  });

  it("normalizes axios errors with retryable flag", () => {
    const provider = createProvider();
    const error = {
      isAxiosError: true,
      response: {
        status: 429,
        data: {
          error: {
            code: 429,
            message: "quota exceeded",
          },
        },
        headers: {
          "retry-after": "10",
        },
      },
      message: "Request failed",
    };
    const normalized = provider.normalizeError(error) as ProviderError;
    expect(normalized).toEqual(
      expect.objectContaining({
        code: "429",
        message: "quota exceeded",
        retryable: true,
      })
    );
  });

  it("falls back to unknown error structure when error is not axios", () => {
    const provider = createProvider();
    const normalized = provider.normalizeError(new Error("boom"));
    expect(normalized).toEqual(
      expect.objectContaining({
        code: "Error",
        message: "boom",
        retryable: false,
      })
    );
  });
});
