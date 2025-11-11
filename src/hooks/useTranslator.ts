import { useTranslatorContext } from "@/contexts/TranslatorContext";
import type { TranslatorContextType } from "@/types";

export const useTranslator = (): TranslatorContextType => {
  return useTranslatorContext();
};
