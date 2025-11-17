import { createTranslationProvider } from "@/external/providers/factory";
import { GoogleTranslateProvider } from "@/external/providers/googleTranslateProvider";
import type { ProviderConfig } from "@/types";
import type { TranslationProvider } from "@/external/providers/types";

jest.mock("@/external/providers/googleTranslateProvider");

const createMockProvider = (
  overrides: Partial<TranslationProvider> = {}
): TranslationProvider => ({
  type: "custom",
  translate: jest.fn(),
  isAvailable: jest.fn(),
  normalizeError: jest.fn(),
  ...overrides,
});

describe("createTranslationProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe("Google provider", () => {
    it("creates and validates GoogleTranslateProvider for google id", () => {
      const config: ProviderConfig = {
        id: "google",
        apiKey: "test-key",
      };
      const mockInstance = createMockProvider({ type: "google" });
      (GoogleTranslateProvider as jest.MockedClass<typeof GoogleTranslateProvider>).mockImplementationOnce(
        () => mockInstance as GoogleTranslateProvider
      );
      const provider = createTranslationProvider(config);
      expect(GoogleTranslateProvider).toHaveBeenCalledWith(config);
      expect(provider).toBe(mockInstance);
    });
  });

  describe("Custom provider with implementation", () => {
    it("returns provided implementation when valid", () => {
      const mockProvider = createMockProvider();
      const config: ProviderConfig = {
        id: "custom",
        implementation: mockProvider,
      };
      const provider = createTranslationProvider(config);
      expect(provider).toBe(mockProvider);
    });

    it("validates custom implementation has type property", () => {
      const mockProvider = createMockProvider();
      const providerWithoutType = {
        translate: mockProvider.translate,
        isAvailable: mockProvider.isAvailable,
        normalizeError: mockProvider.normalizeError,
      } as TranslationProvider;
      const config: ProviderConfig = {
        id: "custom",
        implementation: providerWithoutType,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider missing required 'type' property"
      );
    });

    it("validates custom implementation has translate method", () => {
      const mockProvider = createMockProvider();
      const providerWithoutTranslate = {
        type: mockProvider.type,
        isAvailable: mockProvider.isAvailable,
        normalizeError: mockProvider.normalizeError,
      } as TranslationProvider;
      const config: ProviderConfig = {
        id: "custom",
        implementation: providerWithoutTranslate,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider missing required 'translate' method"
      );
    });

    it("validates isAvailable is a function if present", () => {
      const mockProvider = createMockProvider({
        isAvailable: "not a function" as unknown as TranslationProvider["isAvailable"],
      });
      const config: ProviderConfig = {
        id: "custom",
        implementation: mockProvider,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider 'isAvailable' must be a function"
      );
    });

    it("validates normalizeError is a function if present", () => {
      const mockProvider = createMockProvider({
        normalizeError: "not a function" as unknown as TranslationProvider["normalizeError"],
      });
      const config: ProviderConfig = {
        id: "custom",
        implementation: mockProvider,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider 'normalizeError' must be a function"
      );
    });

    it("accepts custom provider with only required properties", () => {
      const minimalProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn(),
      };
      const config: ProviderConfig = {
        id: "custom",
        implementation: minimalProvider,
      };
      const provider = createTranslationProvider(config);
      expect(provider).toBe(minimalProvider);
    });
  });

  describe("Custom provider with factory", () => {
    it("invokes factory and returns provider when valid", () => {
      const mockProvider = createMockProvider();
      const factory = jest.fn(() => mockProvider);
      const config: ProviderConfig = {
        id: "custom",
        factory,
      };
      const provider = createTranslationProvider(config);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(provider).toBe(mockProvider);
    });

    it("validates factory-created provider has type property", () => {
      const mockProvider = createMockProvider();
      const providerWithoutType = {
        translate: mockProvider.translate,
        isAvailable: mockProvider.isAvailable,
        normalizeError: mockProvider.normalizeError,
      } as TranslationProvider;
      const factory = jest.fn(() => providerWithoutType);
      const config: ProviderConfig = {
        id: "custom",
        factory,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider missing required 'type' property"
      );
    });

    it("validates factory-created provider has translate method", () => {
      const mockProvider = createMockProvider();
      const providerWithoutTranslate = {
        type: mockProvider.type,
        isAvailable: mockProvider.isAvailable,
        normalizeError: mockProvider.normalizeError,
      } as TranslationProvider;
      const factory = jest.fn(() => providerWithoutTranslate);
      const config: ProviderConfig = {
        id: "custom",
        factory,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider missing required 'translate' method"
      );
    });

    it("accepts factory-created provider with only required properties", () => {
      const minimalProvider: TranslationProvider = {
        type: "custom",
        translate: jest.fn(),
      };
      const factory = jest.fn(() => minimalProvider);
      const config: ProviderConfig = {
        id: "custom",
        factory,
      };
      const provider = createTranslationProvider(config);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(provider).toBe(minimalProvider);
    });
  });

  describe("Error cases", () => {
    it("throws when custom provider has neither implementation nor factory", () => {
      const config: ProviderConfig = {
        id: "custom",
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Custom provider configuration must include either 'implementation' or 'factory'"
      );
    });

    it("throws when provider instance is null", () => {
      const factory = jest.fn(() => null as unknown as TranslationProvider);
      const config: ProviderConfig = {
        id: "custom",
        factory,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider instance is null or undefined"
      );
    });

    it("throws when provider instance is undefined", () => {
      const factory = jest.fn(() => undefined as unknown as TranslationProvider);
      const config: ProviderConfig = {
        id: "custom",
        factory,
      };
      expect(() => createTranslationProvider(config)).toThrow(
        "Provider instance is null or undefined"
      );
    });
  });

  describe("Precedence", () => {
    it("prefers implementation over factory when both provided", () => {
      const mockImplementation = createMockProvider({ type: "custom" });
      const mockFactory = jest.fn(() => createMockProvider({ type: "custom" }));
      const config: ProviderConfig = {
        id: "custom",
        implementation: mockImplementation,
        factory: mockFactory,
      };
      const provider = createTranslationProvider(config);
      expect(mockFactory).not.toHaveBeenCalled();
      expect(provider).toBe(mockImplementation);
    });
  });
});
