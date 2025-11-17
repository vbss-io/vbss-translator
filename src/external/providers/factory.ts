import type { ProviderConfig } from "@/types";
import type { TranslationProvider } from "@/external/providers/types";
import { GoogleTranslateProvider } from "@/external/providers/googleTranslateProvider";

const validateProvider = (provider: TranslationProvider): void => {
  if (!provider) {
    throw new Error("Provider instance is null or undefined");
  }

  if (!provider.type) {
    throw new Error("Provider missing required 'type' property");
  }

  if (typeof provider.translate !== "function") {
    throw new Error("Provider missing required 'translate' method");
  }

  if (provider.isAvailable && typeof provider.isAvailable !== "function") {
    throw new Error("Provider 'isAvailable' must be a function");
  }

  if (provider.normalizeError && typeof provider.normalizeError !== "function") {
    throw new Error("Provider 'normalizeError' must be a function");
  }
};

export const createTranslationProvider = (
  config: ProviderConfig
): TranslationProvider => {
  if (config.id === "google") {
    const provider = new GoogleTranslateProvider(config);
    validateProvider(provider);
    return provider;
  }

  if (config.implementation) {
    validateProvider(config.implementation);
    return config.implementation;
  }

  if (config.factory) {
    const provider = config.factory();
    validateProvider(provider);
    return provider;
  }

  throw new Error(
    "Custom provider configuration must include either 'implementation' or 'factory'"
  );
};
