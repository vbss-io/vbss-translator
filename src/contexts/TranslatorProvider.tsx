import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";

import { TranslatorContext } from "@/contexts/TranslatorContext";
import { ExternalTranslationManager } from "@/external/ExternalTranslationManager";
import { TranslationCache } from "@/external/cache/TranslationCache";
import { GoogleTranslateProvider } from "@/external/providers/googleTranslateProvider";
import type { TranslationStatus } from "@/external/types";
import type { ExternalTranslationConfigInput } from "@/types";
import {
  TranslatorProviderType,
  type CacheConfig,
  type ExternalTranslationConfig,
  type ProviderConfig,
  type TranslateOptions,
} from "@/types";

const STORAGE_SCOPE = "translator";
const DEFAULT_TIMEOUT_MS = 5_000;
const ERROR_RETRY_DELAY_MS = 30_000;
const RECORD_SEPARATOR = "::";

const getBrowserLanguage = (fallback: string) => {
  const lang = navigator?.language?.split("-")?.[0];
  return lang || fallback;
};

const getPersistedLanguage = (key: string) => {
  return localStorage.getItem(key);
};

const setPersistedLanguage = (persistKey: string, lang: string) => {
  localStorage.setItem(persistKey, lang);
};

type ExternalTranslationState = {
  readonly status: TranslationStatus;
  readonly value?: string;
  readonly error?: unknown;
  readonly retryAt?: number;
};

type ExternalStateMap = Map<string, Map<string, ExternalTranslationState>>;

type TranslationEntry = TranslatorProviderType["translations"][number];

const toReadonlySet = (
  entries?: ReadonlyArray<string> | ReadonlySet<string>
) => {
  if (!entries) {
    return new Set<string>();
  }
  if (entries instanceof Set) {
    return new Set(entries);
  }
  return new Set(entries);
};

const createPayload = (
  event: string,
  context: Record<string, unknown>
): Record<string, unknown> => ({
  scope: STORAGE_SCOPE,
  event,
  ...context,
});

const logWarning = (event: string, context: Record<string, unknown>) => {
  console.warn("[vbss-translator]", createPayload(event, context));
};

const logDebug = (event: string, context: Record<string, unknown>) => {
  console.debug("[vbss-translator]", createPayload(event, context));
};

const createExternalLogger = () => ({
  warn: (event: string, context?: Record<string, unknown>) => {
    logWarning(event, context ?? {});
  },
  debug: (event: string, context?: Record<string, unknown>) => {
    logDebug(event, context ?? {});
  },
});

const resolveExternalTranslationConfig = (
  input?: ExternalTranslationConfigInput
): ExternalTranslationConfig => {
  const {
    provider,
    cache,
    alwaysExternalKeys,
    enabled,
    timeoutMs,
    debug,
    ...callbacks
  } = input ?? {};
  return {
    enabled: enabled ?? true,
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    debug: debug ?? false,
    provider: {
      ...DEFAULT_PROVIDER_CONFIG,
      ...provider,
    },
    cache: {
      ...DEFAULT_CACHE_CONFIG,
      ...cache,
    },
    alwaysExternalKeys: toReadonlySet(alwaysExternalKeys),
    ...callbacks,
  };
};

const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  id: "google",
};

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: false,
  ttlMs: 3_600_000,
};

const createRecordKey = (key: string, language: string) =>
  `${key}${RECORD_SEPARATOR}${language}`;

const toMapCopy = <K, V>(source?: Map<K, V>) => {
  return source ? new Map(source) : new Map<K, V>();
};

const findTranslationMatch = (
  text: string,
  translationList: ReadonlyArray<TranslationEntry>
): TranslationEntry | undefined => {
  const normalized = text.toLocaleLowerCase();
  return translationList.find((entry) =>
    Object.values(entry).some(
      (value) => value.toLocaleLowerCase() === normalized
    )
  );
};

export const TranslatorProvider = ({
  children,
  translations,
  defaultLanguage = "en",
  persist = false,
  persistKey = "language",
  autoDetectLanguage = false,
  externalTranslation,
}: TranslatorProviderType) => {
  const baseExternalConfig = useMemo(
    () => resolveExternalTranslationConfig(externalTranslation),
    [externalTranslation]
  );
  const [externalKeys, setExternalKeys] = useState<Set<string>>(
    () => new Set(baseExternalConfig.alwaysExternalKeys)
  );

  useEffect(() => {
    setExternalKeys((previous) => {
      const next = new Set(baseExternalConfig.alwaysExternalKeys);
      previous.forEach((key) => next.add(key));
      return next;
    });
  }, [baseExternalConfig]);

  const registerExternalKey = useCallback((key: string) => {
    setExternalKeys((previous) => {
      if (previous.has(key)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(key);
      return next;
    });
  }, []);

  const externalConfig = useMemo<ExternalTranslationConfig>(
    () => ({
      ...baseExternalConfig,
      alwaysExternalKeys: externalKeys,
    }),
    [baseExternalConfig, externalKeys]
  );

  const persistedLanguage = persist ? getPersistedLanguage(persistKey) : null;
  const autoDetectedLanguage = autoDetectLanguage
    ? getBrowserLanguage(defaultLanguage)
    : null;
  const [language, setLanguage] = useState<string>(
    persistedLanguage ?? autoDetectedLanguage ?? defaultLanguage
  );

  useEffect(() => {
    if (persist) {
      setPersistedLanguage(persistKey, language);
    }
  }, [language, persist, persistKey]);

  const languages = useMemo(
    () => Object.keys(translations[0] || {}),
    [translations]
  );

  const externalLogger = useMemo(() => createExternalLogger(), []);

  const translationCache = useMemo(
    () => new TranslationCache(externalConfig.cache),
    [externalConfig.cache]
  );

  const translationManager = useMemo(
    () =>
      new ExternalTranslationManager({
        provider: new GoogleTranslateProvider(externalConfig.provider),
        config: externalConfig,
        cache: externalConfig.cache.enabled ? translationCache : undefined,
        logger: externalLogger,
      }),
    [externalConfig, externalLogger, translationCache]
  );

  const [externalState, setExternalState] = useState<ExternalStateMap>(
    () => new Map()
  );

  const [updateCounter, forceUpdate] = useState(0);

  const isMountedRef = useRef(true);
  useEffect(() => {
    if (externalConfig.debug) {
      logDebug("TranslatorProvider_mounted", {
        timestamp: Date.now(),
      });
    }
    isMountedRef.current = true;
    return () => {
      if (externalConfig.debug) {
        logDebug("TranslatorProvider_unmounting", {
          timestamp: Date.now(),
        });
      }
      isMountedRef.current = false;
    };
  }, [externalConfig]);

  const setExternalStateEntry = useCallback(
    (
      targetLanguage: string,
      key: string,
      entry: ExternalTranslationState | undefined
    ) => {
      if (externalConfig.debug && entry) {
        logDebug("setExternalStateEntry_called", {
          targetLanguage,
          key,
          status: entry.status,
          value: entry.value,
          isMounted: isMountedRef.current,
        });
      }
      const updateState = () => {
        setExternalState((previous) => {
          const next = new Map(previous);
          const mapForLanguage = toMapCopy(next.get(targetLanguage));
          if (entry) {
            mapForLanguage.set(key, entry);
            next.set(targetLanguage, mapForLanguage);
          } else {
            mapForLanguage.delete(key);
            if (mapForLanguage.size > 0) {
              next.set(targetLanguage, mapForLanguage);
            } else {
              next.delete(targetLanguage);
            }
          }
          return next;
        });
        if (entry?.status === "resolved") {
          if (externalConfig.debug) {
            logDebug("forceUpdate_triggered", {
              targetLanguage,
              key,
            });
          }
          forceUpdate((n) => n + 1);
        }
      };

      const isTestEnv =
        typeof process !== "undefined" && process.env?.NODE_ENV === "test";

      if (isTestEnv) {
        updateState();
      } else {
        startTransition(() => {
          updateState();
        });
      }
    },
    [externalConfig, forceUpdate]
  );

  const startExternalTranslation = useCallback(
    (params: {
      key: string;
      targetLanguage: string;
      originalText: string;
      displayValue: string;
      sourceLanguage?: string;
      options?: TranslateOptions;
    }) => {
      if (!translationManager.isEnabled()) {
        return;
      }
      setExternalStateEntry(params.targetLanguage, params.key, {
        status: "pending",
        value: params.displayValue,
      });
      void translationManager
        .translate({
          key: params.key,
          text: params.originalText,
          targetLanguage: params.targetLanguage,
          sourceLanguage: params.sourceLanguage,
          signal: params.options?.signal,
        })
        .then((result) => {
          if (externalConfig.debug) {
            logDebug("translation_promise_resolved", {
              key: params.key,
              targetLanguage: params.targetLanguage,
              isMounted: isMountedRef.current,
              hasResult: !!result,
              hasTranslatedText: !!(result && result.translatedText),
              translatedText: result?.translatedText,
            });
          }
          if (result && result.translatedText) {
            if (externalConfig.debug) {
              logDebug("translation_applying_resolved", {
                key: params.key,
                targetLanguage: params.targetLanguage,
                isMounted: isMountedRef.current,
                translatedText: result.translatedText,
              });
            }
            setExternalStateEntry(params.targetLanguage, params.key, {
              status: "resolved",
              value: result.translatedText,
            });
            return;
          }
          if (externalConfig.debug) {
            logDebug("translation_invalid_result", {
              key: params.key,
              result,
            });
          }
          setExternalStateEntry(params.targetLanguage, params.key, {
            status: "error",
            value: params.displayValue,
            retryAt: Date.now() + ERROR_RETRY_DELAY_MS,
          });
        })
        .catch((error) => {
          if (externalConfig.debug) {
            logDebug("translation_promise_rejected", {
              key: params.key,
              targetLanguage: params.targetLanguage,
              isMounted: isMountedRef.current,
              error: error?.message || String(error),
            });
          }
          logWarning("external_translation_unexpected_rejection", {
            key: params.key,
            language: params.targetLanguage,
            error,
            isMounted: isMountedRef.current,
          });
          setExternalStateEntry(params.targetLanguage, params.key, {
            status: "error",
            value: params.displayValue,
            error,
            retryAt: Date.now() + ERROR_RETRY_DELAY_MS,
          });
        });
    },
    [externalConfig, setExternalStateEntry, translationManager]
  );

  const isTranslatingRecord = useMemo(() => {
    const record: Record<string, boolean> = {};
    externalState.forEach((mapForLanguage, lang) => {
      mapForLanguage.forEach((state, key) => {
        record[createRecordKey(key, lang)] = state.status === "pending";
      });
    });
    if (externalConfig.debug) {
      logDebug("isTranslatingRecord_recalculated", {
        recordSize: Object.keys(record).length,
        record: { ...record },
      });
    }
    return record;
  }, [externalState, externalConfig]);

  const isTranslatingAny = useMemo(
    () => Object.values(isTranslatingRecord).some(Boolean),
    [isTranslatingRecord]
  );

  const t = useCallback(
    (text: string, options: TranslateOptions = {}): string => {
      const stateForLanguage = externalState.get(language);
      const existingState = stateForLanguage?.get(text);
      if (externalConfig.debug && options.preferExternal) {
        logDebug("t_called", {
          text,
          language,
          hasStateForLanguage: !!stateForLanguage,
          existingStateStatus: existingState?.status,
          existingStateValue: existingState?.value,
          preferExternal: options.preferExternal,
        });
      }
      if (existingState?.status === "resolved" && existingState.value) {
        if (externalConfig.debug) {
          logDebug("t_returning_resolved", {
            text,
            value: existingState.value,
          });
        }
        return existingState.value;
      }
      const translation = findTranslationMatch(text, translations);
      const localValue = translation?.[language];
      const firstEntryValue = translation
        ? Object.values(translation).find((value) => Boolean(value))
        : undefined;
      const fallbackValue =
        options.fallbackValue ??
        existingState?.value ??
        localValue ??
        firstEntryValue ??
        text;
      const shouldForceExternal =
        options.preferExternal === true ||
        externalConfig.alwaysExternalKeys.has(text);
      const managerEnabled = translationManager.isEnabled();
      const hasLocalTranslation = typeof localValue === "string";
      if (!hasLocalTranslation) {
        logWarning("missing_translation", {
          key: text,
          language,
        });
      }
      const shouldUseExternal =
        managerEnabled && (shouldForceExternal || !hasLocalTranslation);
      if (!shouldUseExternal) {
        if (existingState?.status === "pending" && existingState.value) {
          return existingState.value;
        }
        return localValue ?? fallbackValue;
      }
      const now = Date.now();
      const canRetryAfterError =
        existingState?.status === "error" &&
        (!existingState.retryAt || existingState.retryAt <= now);
      if (!existingState || canRetryAfterError) {
        const explicitSourceLanguage = options.sourceLanguage;
        const derivedSourceLanguage =
          explicitSourceLanguage ??
          (translation && translation[defaultLanguage]
            ? defaultLanguage
            : undefined);
        const sourceText =
          (derivedSourceLanguage && translation?.[derivedSourceLanguage]) ??
          translation?.[defaultLanguage] ??
          text;
        startExternalTranslation({
          key: text,
          targetLanguage: language,
          originalText: sourceText,
          displayValue: existingState?.value ?? fallbackValue,
          sourceLanguage: derivedSourceLanguage,
          options,
        });
      }
      const latestState =
        externalState.get(language)?.get(text) ?? existingState;
      if (latestState?.status === "resolved" && latestState.value) {
        return latestState.value;
      }
      if (latestState?.status === "pending") {
        return latestState.value ?? fallbackValue;
      }
      return fallbackValue;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      defaultLanguage,
      externalConfig.alwaysExternalKeys,
      externalState,
      language,
      startExternalTranslation,
      translationManager,
      translations,
    ]
  );

  const contextValue = useMemo(
    () => ({
      t,
      language,
      languages,
      setLanguage,
      isTranslating: isTranslatingRecord,
      isTranslatingAny,
      registerExternalKey,
      externalConfig,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      language,
      languages,
      setLanguage,
      isTranslatingRecord,
      isTranslatingAny,
      registerExternalKey,
      externalConfig,
      updateCounter,
    ]
  );

  return (
    <TranslatorContext.Provider value={contextValue}>
      {children}
    </TranslatorContext.Provider>
  );
};
