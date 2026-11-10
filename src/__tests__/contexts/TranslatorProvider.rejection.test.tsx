import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { useTranslatorContext } from "@/contexts/TranslatorContext";
import type { ExternalTranslationConfigInput } from "@/types";

const translateMock = jest.fn();

jest.mock("@/external/ExternalTranslationManager", () => ({
  ExternalTranslationManager: jest.fn().mockImplementation(() => ({
    translate: translateMock,
    isEnabled: () => true,
  })),
}));

const translations = [{ en: "Hello", pt: "Ola" }];

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }
  });
};

const renderProvider = (external: ExternalTranslationConfigInput) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TranslatorProvider
      translations={translations}
      defaultLanguage="pt"
      externalTranslation={external}
    >
      {children}
    </TranslatorProvider>
  );
  return renderHook(() => useTranslatorContext(), { wrapper });
};

const config = (debug: boolean): ExternalTranslationConfigInput => ({
  enabled: true,
  debug,
  provider: {
    id: "custom",
    implementation: {
      type: "custom",
      translate: jest.fn(),
    },
  },
});

describe("TranslatorProvider when the manager rejects unexpectedly", () => {
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    translateMock.mockReset();
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    debug = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("warns, stops loading and keeps the displayed text", async () => {
    const failure = new Error("manager exploded");
    translateMock.mockRejectedValue(failure);
    const { result } = renderProvider(config(false));
    act(() => {
      result.current.t("Missing");
    });
    await settle();
    expect(warn).toHaveBeenCalledWith(
      "[vbss-translator]",
      expect.objectContaining({
        scope: "translator",
        event: "external_translation_unexpected_rejection",
        key: "Missing",
        language: "pt",
        error: failure,
      })
    );
    expect(result.current.isTranslating["Missing::pt"]).toBe(false);
    expect(result.current.t("Missing")).toBe("Missing");
    expect(translateMock).toHaveBeenCalledTimes(1);
  });

  it("retries only after the error delay has elapsed", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    translateMock.mockRejectedValueOnce(new Error("first"));
    translateMock.mockResolvedValueOnce({ translatedText: "Recovered" });
    const { result } = renderProvider(config(false));
    act(() => {
      result.current.t("Missing");
    });
    await settle();
    jest.setSystemTime(new Date("2026-01-01T00:00:29Z"));
    act(() => {
      result.current.t("Missing");
    });
    await settle();
    expect(translateMock).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date("2026-01-01T00:00:31Z"));
    act(() => {
      result.current.t("Missing");
    });
    await settle();
    expect(translateMock).toHaveBeenCalledTimes(2);
    expect(result.current.t("Missing")).toBe("Recovered");
  });

  it("logs the rejection message when debug is on", async () => {
    translateMock.mockRejectedValue(new Error("manager exploded"));
    const { result, unmount } = renderProvider(config(true));
    act(() => {
      result.current.t("Missing");
    });
    await settle();
    expect(debug).toHaveBeenCalledWith(
      "[vbss-translator]",
      expect.objectContaining({
        event: "translation_promise_rejected",
        key: "Missing",
        error: "manager exploded",
      })
    );
    unmount();
  });

  it("stringifies a rejection that is not an Error when debug is on", async () => {
    translateMock.mockRejectedValue("plain failure");
    const { result, unmount } = renderProvider(config(true));
    act(() => {
      result.current.t("Missing");
    });
    await settle();
    expect(debug).toHaveBeenCalledWith(
      "[vbss-translator]",
      expect.objectContaining({
        event: "translation_promise_rejected",
        error: "plain failure",
      })
    );
    unmount();
  });
});
