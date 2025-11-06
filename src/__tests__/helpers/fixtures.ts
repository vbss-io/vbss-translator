import type { Translation } from "@/types";

export const mockTranslations: Translation[] = [
  {
    en: "Hello",
    pt: "Olá",
    es: "Hola",
  },
  {
    en: "Goodbye",
    pt: "Adeus",
    es: "Adiós",
  },
  {
    en: "Welcome",
    pt: "Bem-vindo",
    es: "Bienvenido",
  },
  {
    en: "Thank you",
    pt: "Obrigado",
    es: "Gracias",
  },
  {
    en: "Please",
    pt: "Por favor",
    es: "Por favor",
  },
];

export const mockTranslationsWithEdgeCases: Translation[] = [
  {
    en: "Hello",
    pt: "Olá",
    es: "Hola",
  },
  {
    en: "HELLO",
    pt: "OLÁ",
    es: "HOLA",
  },
  {
    en: "hello",
    pt: "olá",
    es: "hola",
  },
  {
    en: "",
    pt: "Vazio",
    es: "Vacío",
  },
];

export const emptyTranslations: Translation[] = [];
