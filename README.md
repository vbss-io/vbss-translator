# vbss-translator

A lightweight React translation toolkit focused on ergonomics, sensible defaults, and escape hatches when local dictionaries are not enough. Ship multilingual web apps with a context-driven provider, `useTranslator` hook, and a CLI that keeps translation indexes in sync.

## Support the Project

Help us keep vbss-translator free and maintained:

- Buy me a coffee: [buymeacoffee.com/vbss.io](https://www.buymeacoffee.com/vbss.io)
- Star on GitHub: [github.com/vbss-io/vbss-translator](https://github.com/vbss-io/vbss-translator)
- Share the tool: [ui.vbss.io/tools/vbss-translator](https://ui.vbss.io/tools/vbss-translator)

---

## Feature Highlights

- React context + hook with zero-config setup
- Auto-detect browser language and persist selections
- External fallback (Google Translate out-of-the-box, custom providers supported) with caching, dedupe, veto hooks, and structured logs
- Translation status flags for fine-grained loading states
- Programmatic translation generator CLI with watch mode and rich validation
- Battle-tested with Jest + React Testing Library

---

## Installation

```bash
npm install vbss-translator
# or
yarn add vbss-translator
```

---

## Quick Start

1. Create a translation file (`src/translations.json`):

```json
[
  { "en": "Hello", "pt": "Olá" },
  { "en": "Goodbye", "pt": "Adeus" }
]
```

1. Mount the provider in your app:

```typescript
import ReactDOM from "react-dom";
import translations from "./translations.json" assert { type: "json" };
import { TranslatorProvider } from "vbss-translator";

ReactDOM.render(
  <TranslatorProvider translations={translations}>
    <App />
  </TranslatorProvider>,
  document.getElementById("root")
);
```

1. Consume translations with the hook:

```typescript
import { useTranslator } from "vbss-translator";

export function Greeting() {
  const { t, language, setLanguage } = useTranslator();

  return (
    <>
      <h1>{t("Hello")}</h1>
      <p>Currently showing: {language}</p>
      <button onClick={() => setLanguage("en")}>English</button>
      <button onClick={() => setLanguage("pt")}>Português</button>
    </>
  );
}
```

---

## Local Translations & Matching Rules

- `translations` must be an array of objects where every object uses the same language keys.
- When `t(text)` is called, the provider performs a **case-insensitive match across every value** in the translation array. The first record containing that value becomes the source dictionary entry.
- Given the matched entry:
  - The translation for the active language is returned if available.
  - Fallback order: explicit `fallbackValue` → cached external value → first non-empty value in the entry → the original input string.

This means you can seed your UI with any language copy (`t("Olá")`) as long as the entry exists with consistent language keys.

---

## Managing Languages

| Capability | How it works |
| --- | --- |
| Default language | `defaultLanguage` prop (defaults to `en`). |
| Auto-detect browser language | Set `autoDetectLanguage`. The navigator language (e.g. `pt-BR`) is simplified to its base (`pt`) before lookup. Falls back to `defaultLanguage` if missing. |
| Persist between reloads | Enable `persist`. The active language is stored under `persistKey` (defaults to `language`) in `localStorage`. |

Language changes happen inside a React transition to keep UI responsive.

---

## `TranslateOptions`

Pass options to `t(key, options)` for scoped behaviour:

| Option | Type | Description |
| --- | --- | --- |
| `preferExternal` | `boolean` | Force an external translation even if a local translation exists. |
| `sourceLanguage` | `string` | Explicit source language when translating externally. If omitted, the provider tries to use `defaultLanguage` when available. |
| `fallbackValue` | `string` | UI text to show until a translation resolves (useful for skeletons/placeholders). |
| `signal` | `AbortSignal` | Cancels the external request via the underlying provider. |

---

## External Translation Pipeline

External translation is **disabled by default**. Enable it by passing `externalTranslation={{ enabled: true }}` with your provider configuration (e.g., Google Translate).

### Key Concepts

- **Always external keys**: Strings registered via `registerExternalKey(key)` or declared in `externalTranslation.alwaysExternalKeys` skip local dictionaries and go straight to the provider.
- **Status tracking**:
  - `isTranslatingAny`: `true` when any external request is running.
  - `isTranslating["your-key::pt"]`: `true` while the specific key/language pair is pending.
- **Retry window**: Failed external requests enter an error state and are retried after 30 seconds when requested again.

### Configuration Surface

```typescript
const externalTranslation = {
  enabled: true,
  timeoutMs: 5_000,
  debug: false,
  provider: {
    id: "google",
    apiKey: process.env.GOOGLE_TRANSLATE_KEY,
    endpoint: "https://translation.googleapis.com/language/translate/v2",
  },
  cache: {
    enabled: true,
    ttlMs: 30 * 60 * 1000,
    maxEntries: 500,
  },
  glossary: {
    // Optional terminology map forwarded to providers that support glossaries
    BRAND_A: "Marca A",
  },
  alwaysExternalKeys: ["product.description"],
  shouldTranslate: ({ key, text }) => !text.includes("SECRET"),
  onExternalTranslation: ({ key, text }) => {
    console.info("sending text to provider", { key, text });
    // Return false (or a resolved Promise) to veto the request.
  },
  onTranslationError: ({ key, language, error }) => {
    console.warn("translation failed", { key, language, error });
  },
  onTranslationComplete: (result) => {
    console.log("external result", result.translatedText);
  },
};
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Master switch for the entire pipeline. |
| `timeoutMs` | `number` | `5_000` | Max duration before aborting a request. Exposed to provider via `AbortController`. |
| `debug` | `boolean` | `false` | Emits structured logs for cache hits, deduped requests, retries, etc. |
| `provider` | `ProviderConfig` | `{ id: "google" }` | Google or custom provider config. See provider sections below. |
| `cache` | `CacheConfig` | `{ enabled: false, ttlMs: 3_600_000 }` | In-memory cache with TTL and optional LRU size limit (`maxEntries`). |
| `glossary` | `Record<string, string>` | `undefined` | Optional term overrides sent when the provider supports them. |
| `alwaysExternalKeys` | `ReadonlySet` | `new Set()` | Automatically merged with strings registered at runtime. |
| `shouldTranslate` | `(request) => boolean` | `undefined` | Synchronous guard invoked before caching/dedup. Exceptions default to `true`. |
| `onExternalTranslation` | `(request) => void \| boolean` | `undefined` | Async-friendly hook after `shouldTranslate` but before the network call. Returning `false` cancels the request. |
| `onTranslationError` | `(event) => void` | `undefined` | Receives normalized provider errors with retry metadata. |
| `onTranslationComplete` | `(result) => void` | `undefined` | Fires after a successful response and cache write. |

### Provider Behaviour

- The Google provider (`src/external/providers/googleTranslateProvider.ts`) constructs REST calls to the v2 API, supports Glossaries, forwards custom headers, and normalizes errors (incl. retryable codes).
- Providers may implement `normalizeError` to produce structured failures consumed by the manager.
- `ExternalTranslationManager` dedupes identical requests, enforces `timeoutMs`, respects `AbortSignal`, handles cache reads/writes, and never throws back into your components. All errors are converted into loggable events and surfaced via callbacks.

### Custom Translation Providers

Beyond Google Translate, you can supply your own translation implementation by configuring a `custom` provider. Custom providers must satisfy the `TranslationProvider` contract, ensuring compatibility with caching, error handling, and instrumentation without additional adapters.

#### Registering a Custom Provider

Supply either an `implementation` (a pre-built provider instance) or a `factory` (a function returning a provider) in your configuration:

```typescript
import {
  TranslatorProvider,
  type TranslationProvider,
  type TranslateRequest,
  type TranslateResult,
} from "vbss-translator";

// Custom provider implementation
const myCustomProvider: TranslationProvider = {
  type: "custom",
  checkAvailability: async () => ({ available: true }),
  translate: async (request: TranslateRequest): Promise<TranslateResult> => {
    // Your custom translation logic here
    const response = await fetch("https://my-translation-api.com/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: request.text,
        source: request.sourceLanguage,
        target: request.targetLanguage,
      }),
    });
    const data = await response.json();
    return {
      translatedText: data.translation,
      detectedSourceLanguage: request.sourceLanguage,
    };
  },
};

<TranslatorProvider
  translations={translations}
  externalTranslation={{
    enabled: true,
    provider: {
      id: "custom",
      implementation: myCustomProvider,
    },
    cache: { enabled: true, ttlMs: 1800000 },
  }}
>
  <App />
</TranslatorProvider>
```

#### Using a Provider Factory

For scenarios requiring initialization logic or dependency injection, supply a factory function:

```typescript
const providerFactory = () => {
  const apiKey = process.env.CUSTOM_TRANSLATION_KEY;
  const endpoint = process.env.CUSTOM_TRANSLATION_ENDPOINT;

  return {
    type: "custom",
    checkAvailability: async () => {
      if (!apiKey || !endpoint) {
        return { available: false, reason: "Missing configuration" };
      }
      return { available: true };
    },
    translate: async (request: TranslateRequest): Promise<TranslateResult> => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: request.text,
          from: request.sourceLanguage,
          to: request.targetLanguage,
          glossary: request.glossary,
        }),
      });
      const data = await response.json();
      return {
        translatedText: data.result,
        providerMetadata: { provider: "custom" },
      };
    },
  };
};

<TranslatorProvider
  translations={translations}
  externalTranslation={{
    enabled: true,
    provider: {
      id: "custom",
      factory: providerFactory,
    },
  }}
>
  <App />
</TranslatorProvider>
```

#### Custom Provider Contract

Your implementation must satisfy the `TranslationProvider` interface:

```typescript
interface TranslationProvider {
  type: string;
  checkAvailability: () => Promise<ProviderAvailability>;
  translate: (request: TranslateRequest) => Promise<TranslateResult>;
  normalizeError?: (error: unknown) => ProviderError;
}
```

- `type`: String identifier for your provider (typically `"custom"`).
- `checkAvailability`: Validates provider readiness (e.g., credentials, network).
- `translate`: Accepts `TranslateRequest` (text, source/target languages, optional glossary) and returns `TranslateResult` (translated text, optional metadata).
- `normalizeError` (optional): Converts provider-specific errors into structured `ProviderError` with retryable flags.

#### Switching Between Providers

Toggle between Google and custom providers without changing downstream code:

```typescript
// Use Google Translate
const googleConfig = {
  enabled: true,
  provider: {
    id: "google",
    apiKey: process.env.GOOGLE_TRANSLATE_KEY,
  },
};

// Use custom provider
const customConfig = {
  enabled: true,
  provider: {
    id: "custom",
    implementation: myCustomProvider,
  },
};

// Select provider at runtime
const activeConfig = useGoogleTranslate ? googleConfig : customConfig;

<TranslatorProvider
  translations={translations}
  externalTranslation={activeConfig}
>
  <App />
</TranslatorProvider>
```

#### Testing Custom Providers

Validate your custom provider before production:

```typescript
import { createTranslationProvider } from "vbss-translator/factory";

const provider = createTranslationProvider({
  id: "custom",
  implementation: myCustomProvider,
});

// Test availability
const availability = await provider.checkAvailability();
console.log("Provider available:", availability.available);

// Test translation
const result = await provider.translate({
  text: "Hello",
  sourceLanguage: "en",
  targetLanguage: "pt",
});
console.log("Translation:", result.translatedText);
```

Custom providers integrate seamlessly with the existing cache, logging, and callback infrastructure. All `shouldTranslate`, `onExternalTranslation`, `onTranslationError`, and `onTranslationComplete` hooks work identically regardless of the active provider.

### Cache Lifecycle

- Cache entries are stored in-memory only.
- `TranslationCache` enforces TTL and `maxEntries` (evicts oldest first).
- `cache.enabled = false` effectively turns the cache into a no-op.
- Debug logs show cache hits/misses when `debug` is enabled.

---

## `TranslatorProvider` Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `translations` | `Translation[]` | required | Array of translation records. |
| `defaultLanguage` | `string` | `"en"` | Fallback when a translation is missing or auto-detect fails. |
| `autoDetectLanguage` | `boolean` | `false` | Use the browser language (base locale) as the initial language. |
| `persist` | `boolean` | `false` | Persist language to `localStorage`. |
| `persistKey` | `string` | `"language"` | Storage key used when `persist` is `true`. |
| `externalTranslation` | `ExternalTranslationConfigInput` | Disabled by default | External translation behaviour, provider credentials, hooks, and logging. |

`TranslatorProvider` exposes a resolved `externalConfig` through context so you can inspect runtime settings (e.g., toggled cache state).

---

## `useTranslator` API

| Property | Type | Description |
| --- | --- | --- |
| `t` | `(text: string, options?: TranslateOptions) => string` | Translate text using local dictionaries + external fallback when needed. |
| `language` | `string` | Currently active language. |
| `languages` | `string[]` | Languages derived from the first translation entry. |
| `setLanguage` | `(lang: string) => void` | Switch languages and persist if enabled. |
| `isTranslating` | `Record<string, boolean>` | Map keyed by `text::language` showing pending external requests. |
| `isTranslatingAny` | `boolean` | `true` when any external request is running. |
| `registerExternalKey` | `(key: string) => void` | Opt a specific string into the external pathway up front. |
| `externalConfig` | `ExternalTranslationConfig` | Read-only resolved configuration (includes merged `alwaysExternalKeys`). |

### Pattern: Preferring External Translation Per Call

```typescript
const abortController = new AbortController();
const { t } = useTranslator();
const description = t("Our newest product line", {
  preferExternal: true,
  fallbackValue: "Loading description…",
  signal: abortController.signal,
});
```

If the external call fails, the original copy is returned and a retry is attempted on subsequent calls after the cooldown window.

---

## CLI & Programmatic Generator

Generate a typed translation index (or plain JS) from scattered JSON files. The CLI orchestrates discovery, validation, deduplication, and file writing.

### Command Reference

```bash
npx vbss-translator generate [--pattern <glob>] [--output <path>] [--format <ts|js|tsx>] \
  [--reference-language <lang>] [--config <path>] [--watch|-w]
```

| Flag | Description | Default |
| --- | --- | --- |
| `--pattern` | Glob for JSON sources. Resolved relative to `process.cwd()`. | `src/**/translations.json` |
| `--output` | Output file path. Parent directories are created automatically. | `src/translations/index.ts` |
| `--format` | Output format (`ts`, `js`, or `tsx`). | `ts` |
| `--reference-language` | Language key used for deduplication. | First language in the first valid file |
| `--config` | Path to `vbss-translator.config.json`. | Project root |
| `--watch`, `-w` | Watch mode with regeneration + debug logs. | Disabled |

Order of precedence: **CLI flags > config file > defaults**. Config parsing is performed by `src/cli/config.ts`.

### Output Formats

- **ts / tsx**: Imports each JSON file with `assert { type: "json" }`, exports a `Translation` interface, merges arrays (wrapping standalone objects), dedupes using the reference language, and default-exports `uniqueTranslations`.
- **js**: Inlines JSON payloads directly into the generated file and performs the same deduplication logic without TypeScript types.

### Validation Rules

The generator checks that:

- Every file parses as JSON (arrays or objects).
- Each translation record only contains string values.
- All entries share identical language keys.
- Language mismatches, missing translations, or file system errors are surfaced as structured `GenerationError`s.

Generation fails fast when validation errors occur; exit code `2` signals schema issues, while other failures exit with `1`.

### Watch Mode

`npx vbss-translator generate --watch`:

- Runs an initial generation before watching.
- Uses native `fs.watch` with glob filtering to detect additions, changes, and deletions.
- Debounces rapid changes (300ms) and regenerates the output file.
- Keeps running until interrupted. Clean-up handlers close watchers on `SIGINT`/`SIGTERM`.
- Emits verbose debug logs to help diagnose path matching.

### Programmatic API

```typescript
import { generate } from "vbss-translator/generator";
import type { GeneratorOptions } from "vbss-translator/generator";

const result = await generate({
  pattern: "src/**/translations.json",
  outputPath: "src/translations/index.ts",
  outputFormat: "ts",
  referenceLanguage: "en",
});

if (!result.success) {
  console.error("Generation failed", result.errors);
}
```

`generate` returns a `GenerationResult` containing success flag, number of files discovered, number of deduplicated translations, accumulated errors, and the output path. The programmatic API shares the same pipeline as the CLI (discovery, validation, dedupe, and writing).

---

## Translation File Requirements

1. **Single object**

   ```json
   { "en": "Hello", "pt": "Olá", "es": "Hola" }
   ```

1. **Array of objects**

   ```json
   [
     { "en": "Hello", "pt": "Olá" },
     { "en": "World", "pt": "Mundo" }
   ]
   ```

Rules enforced by the generator:

- Every entry must use the same set of language keys.
- Every value must be a string.
- Files must be valid JSON (syntax errors are reported).

> These validations are applied when you run the CLI or programmatic generator. Passing your own `Translation[]` straight into `TranslatorProvider` skips these checks, so validate manually if you craft arrays by hand.

---

## Debugging & Best Practices

- Enable `externalTranslation.debug` during development to track cache hits, deduped requests, vetoes, and timing information. Logs are tagged with `[vbss-translator]`.
- Register sensitive copy via `registerExternalKey` only after ensuring `shouldTranslate` and `onExternalTranslation` mask or skip secrets.
- Use `isTranslating` to show per-string loading indicators without blocking initial UI.
- In CI, run `npx vbss-translator generate` to validate translation files early and fail builds on schema drift.
- Version-control generated translation indexes so production builds and CI remain deterministic.

---

## Feedback & Contributing

We love hearing from you! If vbss-translator helps your team, please ⭐ the repo or share feedback.

- GitHub: [github.com/vbss-io/vbss-translator](https://github.com/vbss-io/vbss-translator)

🚀 Happy shipping!
