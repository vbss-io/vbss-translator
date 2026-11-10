import axios from "axios";
import type { AxiosInstance } from "axios";
import { GoogleTranslateProvider } from "@/external/providers/googleTranslateProvider";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

type PostMock = jest.MockedFunction<AxiosInstance["post"]>;

const DEFAULT_ENDPOINT =
  "https://translation.googleapis.com/language/translate/v2";

const okResponse = (
  translation: Record<string, string> = { translatedText: "Hola" }
) => ({ data: { data: { translations: [translation] } } });

const setup = (
  config: ConstructorParameters<typeof GoogleTranslateProvider>[0] = {
    id: "google",
  },
  response: unknown = okResponse()
) => {
  const post = jest.fn().mockResolvedValue(response) as PostMock;
  mockedAxios.create.mockReturnValue({ post } as unknown as AxiosInstance);
  const provider = new GoogleTranslateProvider(config);
  return { provider, post };
};

const axiosError = (
  overrides: {
    status?: number;
    data?: unknown;
    message?: string;
    headers?: Record<string, string>;
  } = {}
) => ({
  isAxiosError: true,
  message: overrides.message ?? "Request failed",
  response:
    overrides.status === undefined && overrides.data === undefined
      ? undefined
      : {
          status: overrides.status,
          data: overrides.data,
          headers: overrides.headers,
        },
});

describe("GoogleTranslateProvider behavior", () => {
  beforeEach(() => {
    mockedAxios.create.mockReset();
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): error is never =>
        Boolean((error as { isAxiosError?: boolean })?.isAxiosError)
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("client creation", () => {
    it("uses the default endpoint and json content type", () => {
      setup();
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: DEFAULT_ENDPOINT,
        headers: { "Content-Type": "application/json" },
      });
    });

    it("uses a custom endpoint and merges configured headers", () => {
      setup({
        id: "google",
        endpoint: "https://proxy.example.com/translate",
        headers: { "X-Tenant": "acme" },
      });
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: "https://proxy.example.com/translate",
        headers: { "Content-Type": "application/json", "X-Tenant": "acme" },
      });
    });
  });

  it("reports itself as available when credentials are configured", () => {
    expect(setup({ id: "google", apiKey: "k" }).provider.isAvailable()).toEqual({
      available: true,
    });
    expect(
      setup({ id: "google", headers: { Authorization: "Bearer x" } }).provider
        .isAvailable()
    ).toEqual({ available: true });
  });

  describe("translate request", () => {
    it("omits the source field for auto detection", async () => {
      const { provider, post } = setup();
      await provider.translate({
        text: "Hello",
        sourceLanguage: "auto",
        targetLanguage: "es",
      });
      expect(post).toHaveBeenCalledWith(
        "",
        { q: "Hello", target: "es", format: "text" },
        expect.objectContaining({ params: undefined })
      );
    });

    it("includes the source field for an explicit language", async () => {
      const { provider, post } = setup();
      await provider.translate({
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "es",
      });
      expect(post.mock.calls[0][1]).toEqual({
        q: "Hello",
        target: "es",
        format: "text",
        source: "en",
      });
    });

    it("omits the source field for an empty source language", async () => {
      const { provider, post } = setup();
      await provider.translate({
        text: "Hello",
        sourceLanguage: "",
        targetLanguage: "es",
      });
      expect(post.mock.calls[0][1]).toEqual({
        q: "Hello",
        target: "es",
        format: "text",
      });
    });

    it("sends the api key as a query parameter", async () => {
      const { provider, post } = setup({ id: "google", apiKey: "secret" });
      await provider.translate({
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "es",
      });
      expect(post.mock.calls[0][2]?.params).toEqual({ key: "secret" });
    });

    it("lets per call headers override configured ones", async () => {
      const { provider, post } = setup({
        id: "google",
        headers: { "X-A": "config", "X-B": "config" },
      });
      await provider.translate(
        { text: "Hello", sourceLanguage: "en", targetLanguage: "es" },
        { headers: { "X-B": "call" } }
      );
      expect(post.mock.calls[0][2]?.headers).toEqual({
        "X-A": "config",
        "X-B": "call",
      });
    });

    it("forwards timeout and abort signal", async () => {
      const { provider, post } = setup();
      const controller = new AbortController();
      await provider.translate(
        { text: "Hello", sourceLanguage: "en", targetLanguage: "es" },
        { timeoutMs: 1500, signal: controller.signal }
      );
      expect(post.mock.calls[0][2]).toEqual(
        expect.objectContaining({ timeout: 1500, signal: controller.signal })
      );
    });

    it("builds glossary terms with the language pair", async () => {
      const { provider, post } = setup();
      await provider.translate({
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "es",
        glossary: { Hello: "Hola", World: "Mundo" },
      });
      expect(post.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          glossaryConfig: {
            glossaryData: {
              languagePair: {
                sourceLanguageCode: "en",
                targetLanguageCode: "es",
              },
              terms: [
                { sourceText: "Hello", targetText: "Hola" },
                { sourceText: "World", targetText: "Mundo" },
              ],
            },
          },
        })
      );
    });

    it("skips the glossary config for an empty glossary", async () => {
      const { provider, post } = setup();
      await provider.translate({
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "es",
        glossary: {},
      });
      expect(post.mock.calls[0][1]).not.toHaveProperty("glossaryConfig");
    });
  });

  describe("translate response", () => {
    const request = {
      text: "Hello",
      sourceLanguage: "en",
      targetLanguage: "es",
    };

    it("returns text, detected language and endpoint metadata", async () => {
      const { provider } = setup(
        { id: "google" },
        okResponse({ translatedText: "Hola", detectedSourceLanguage: "en" })
      );
      await expect(provider.translate(request)).resolves.toEqual({
        translatedText: "Hola",
        detectedSourceLanguage: "en",
        providerMetadata: { endpoint: DEFAULT_ENDPOINT },
      });
    });

    it("adds model, project and region to the metadata when available", async () => {
      const { provider } = setup(
        {
          id: "google",
          endpoint: "https://custom.example.com",
          projectId: "proj-1",
          region: "us-central1",
        },
        okResponse({ translatedText: "Hola", model: "nmt" })
      );
      const outcome = await provider.translate(request);
      expect(outcome.providerMetadata).toEqual({
        endpoint: "https://custom.example.com",
        model: "nmt",
        projectId: "proj-1",
        region: "us-central1",
      });
    });

    it.each([
      ["no data", {}],
      ["no translations", { data: {} }],
      ["an empty translations list", { data: { translations: [] } }],
      ["an empty translated text", okResponse({ translatedText: "" })],
      ["a missing translated text", okResponse({ model: "nmt" })],
    ])("throws when the response has %s", async (_label, response) => {
      const { provider } = setup({ id: "google" }, response);
      await expect(provider.translate(request)).rejects.toThrow(
        "Google Translate response did not include translatedText"
      );
    });

    it("propagates transport failures from axios", async () => {
      const { provider, post } = setup();
      post.mockRejectedValueOnce(new Error("network down"));
      await expect(provider.translate(request)).rejects.toThrow("network down");
    });
  });

  describe("normalizeError", () => {
    const provider = () => setup().provider;

    it("uses the google error code and message from the response body", () => {
      const error = axiosError({
        status: 403,
        data: { error: { code: 403, message: "API key invalid" } },
        headers: { "x-id": "1" },
      });
      expect(provider().normalizeError(error)).toEqual({
        code: "403",
        message: "API key invalid",
        retryable: false,
        details: {
          status: 403,
          data: { error: { code: 403, message: "API key invalid" } },
          headers: { "x-id": "1" },
        },
      });
    });

    it("falls back to the http status and the axios message", () => {
      const normalized = provider().normalizeError(
        axiosError({ status: 404, data: {}, message: "Not Found" })
      );
      expect(normalized.code).toBe("404");
      expect(normalized.message).toBe("Not Found");
    });

    it("uses E_GOOGLE and not retryable when there is no response", () => {
      const normalized = provider().normalizeError(
        axiosError({ message: "socket hang up" })
      );
      expect(normalized).toEqual({
        code: "E_GOOGLE",
        message: "socket hang up",
        retryable: false,
        details: { status: undefined, data: {}, headers: undefined },
      });
    });

    it.each([408, 425, 429, 500, 502, 503, 504])(
      "marks status %i as retryable",
      (status) => {
        expect(
          provider().normalizeError(axiosError({ status, data: {} })).retryable
        ).toBe(true);
      }
    );

    it.each([400, 401, 403, 404, 501])(
      "marks status %i as not retryable",
      (status) => {
        expect(
          provider().normalizeError(axiosError({ status, data: {} })).retryable
        ).toBe(false);
      }
    );

    it("keeps a string error code from the body", () => {
      const normalized = provider().normalizeError(
        axiosError({
          status: 429,
          data: { error: { code: "RATE_LIMITED", message: "slow down" } },
        })
      );
      expect(normalized.code).toBe("RATE_LIMITED");
      expect(normalized.retryable).toBe(true);
    });

    it("normalizes a plain Error", () => {
      const failure = new RangeError("out of range");
      expect(provider().normalizeError(failure)).toEqual({
        code: "RangeError",
        message: "out of range",
        retryable: false,
        details: failure,
      });
    });

    it("uses unknown_error for an Error without a name", () => {
      const failure = new Error("nameless");
      failure.name = "";
      expect(provider().normalizeError(failure).code).toBe("unknown_error");
    });

    it("normalizes a non error value", () => {
      expect(provider().normalizeError(42)).toEqual({
        code: "unknown_error",
        message: "Unknown provider error",
        retryable: false,
        details: 42,
      });
    });
  });
});
