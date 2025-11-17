import { renderHook, act, waitFor } from "@testing-library/react";
import { TranslatorProvider } from "@/contexts/TranslatorProvider";
import { useTranslator } from "@/hooks/useTranslator";
import { mockTranslations } from "@/__tests__/helpers/fixtures";

const externalManagerTranslateMock = jest.fn();
const externalManagerIsEnabledMock = jest.fn(() => true);

jest.mock("@/external/ExternalTranslationManager", () => ({
  ExternalTranslationManager: jest.fn().mockImplementation(() => ({
    translate: externalManagerTranslateMock,
    isEnabled: externalManagerIsEnabledMock,
  })),
}));

describe("useTranslator", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "debug").mockImplementation(() => {});
    externalManagerTranslateMock.mockReset();
    externalManagerIsEnabledMock.mockReset();
    externalManagerIsEnabledMock.mockReturnValue(true);
    externalManagerTranslateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TranslatorProvider translations={mockTranslations} defaultLanguage="en">
      {children}
    </TranslatorProvider>
  );

  it("should expose translator context values including external translation state", () => {
    const { result } = renderHook(() => useTranslator(), { wrapper });
    expect(typeof result.current.t).toBe("function");
    expect(typeof result.current.language).toBe("string");
    expect(Array.isArray(result.current.languages)).toBe(true);
    expect(typeof result.current.setLanguage).toBe("function");
    expect(result.current.isTranslating).toEqual({});
    expect(result.current.isTranslatingAny).toBe(false);
    expect(typeof result.current.registerExternalKey).toBe("function");
    expect(result.current.externalConfig.enabled).toBe(false);
  });

  it("should allow registering external keys through the hook", () => {
    const { result } = renderHook(() => useTranslator(), { wrapper });
    const testKey = "dynamic-description";
    act(() => {
      result.current.registerExternalKey(testKey);
    });
    expect(result.current.externalConfig.alwaysExternalKeys.has(testKey)).toBe(
      true
    );
  });

  it("should report loading state and return translated values after external completion", async () => {
    const resolvingKey = "Dynamic Product";
    const resolvedValue = "Producto Dinámico";
    let resolveTranslation:
      | ((value: { translatedText: string }) => void)
      | undefined;
    externalManagerTranslateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTranslation = resolve;
        })
    );
    const { result } = renderHook(() => useTranslator(), { wrapper });
    act(() => {
      result.current.setLanguage("es");
    });
    let initialValue = "";
    act(() => {
      initialValue = result.current.t(resolvingKey);
    });
    expect(initialValue).toBe(resolvingKey);
    await waitFor(() => {
      expect(result.current.isTranslatingAny).toBe(true);
    });
    await act(async () => {
      resolveTranslation?.({ translatedText: resolvedValue });
      await Promise.resolve();
    });
    expect(result.current.isTranslatingAny).toBe(false);
    let finalValue = "";
    act(() => {
      finalValue = result.current.t(resolvingKey);
    });
    expect(finalValue).toBe(resolvedValue);
    expect(externalManagerTranslateMock).toHaveBeenCalledTimes(1);
  });
});
