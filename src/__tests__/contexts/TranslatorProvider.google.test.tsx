import type { ReactNode } from "react";
import axios from "axios";
import type { AxiosInstance } from "axios";
import { renderHook } from "@testing-library/react";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { useTranslatorContext } from "@/contexts/TranslatorContext";
import type { ExternalTranslationConfigInput } from "@/types";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

const renderWith = (external: ExternalTranslationConfigInput) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TranslatorProvider
      translations={[{ en: "Hello", pt: "Ola" }]}
      defaultLanguage="pt"
      externalTranslation={external}
    >
      {children}
    </TranslatorProvider>
  );
  return renderHook(() => useTranslatorContext(), { wrapper });
};

const unavailableEvents = (warn: jest.SpyInstance) =>
  warn.mock.calls.filter(
    (call) =>
      (call[1] as { event: string }).event ===
      "TranslatorProvider_provider_unavailable"
  );

describe("TranslatorProvider with the google provider", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({
      post: jest.fn(),
    } as unknown as AxiosInstance);
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("warns that the provider is unavailable when google has no credentials", () => {
    renderWith({ enabled: true, provider: { id: "google" } });
    const calls = unavailableEvents(warn);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(
      expect.objectContaining({
        providerType: "google",
        providerId: "google",
        reason: expect.stringContaining("apiKey"),
      })
    );
  });

  it("does not warn about availability while external translation is disabled", () => {
    renderWith({ provider: { id: "google" } });
    expect(unavailableEvents(warn)).toHaveLength(0);
  });

  it("does not warn when google has an api key", () => {
    renderWith({ enabled: true, provider: { id: "google", apiKey: "k" } });
    expect(unavailableEvents(warn)).toHaveLength(0);
  });

  it("does not warn when google points to a custom endpoint", () => {
    renderWith({
      enabled: true,
      provider: { id: "google", endpoint: "https://proxy.example.com/translate" },
    });
    expect(unavailableEvents(warn)).toHaveLength(0);
  });
});
