# vbss-translator

A lightweight and customizable React translation hook to easily handle multilingual websites. Includes support for browser language auto-detection, local persistence of language, and customizable translation files.

## **Support**

Help us keep vbss-translator free and open source. Your support enables continuous development, better docs and new features.

- Buy me a coffee: [buymeacoffee.com/vbss.io](https://www.buymeacoffee.com/vbss.io)
- Star on GitHub: [github.com/vbss-io/vbss-translator](https://github.com/vbss-io/vbss-translator)
- Share with community: [ui.vbss.io/tools/vbss-translator](https://ui.vbss.io/tools/vbss-translator)

Thank you for supporting the project!

---

## Features

- Auto-detect browser language to set the initial language.
- Persist selected language in local storage.
- Customizable and dynamic translation keys.
- Minimalistic integration with React via useTranslator hook.
- Flexible and developer-friendly API.
- CLI tool to generate translation index files from multiple translation JSON files scattered across your project.
- Tested with Jest and React Testing Library.

---

## Installation

Install the package using npm:

```bash
npm install vbss-translator
```

or yarn:

```bash
yarn add vbss-translator
```

or Github Registry:

```bash
 npm install @vbss-io/vbss-translator@0.0.1
```

*Github Registry may cause incompatibility with npm registry.*

---

## Usage

### Setup the `TranslatorProvider`

Create a JSON file for translations. For example: `translations.json`

```json
[
  {
    "en": "Hello",
    "pt": "Olá"
  },
  {
    "en": "Goodbye",
    "pt": "Adeus"
  }
]
```

Wrap your application with the TranslatorProvider to make the translator context available throughout your app.

```typescript
import translations from './translations.json';

ReactDOM.render(
  <TranslatorProvider translations={translations}>
    <App />
  </TranslatorProvider>,
  document.getElementById('root')
);
```

### Use the `useTranslator` Hook

The useTranslator hook provides access to the t function for translations and methods to manage the current language.

Example Usage in Components:

```typescript
import React from 'react';
import { useTranslator } from 'vbss-translator';

const ExampleComponent = () => {
  const { t, setLanguage, language } = useTranslator();

  return (
    <div>
      <h1>{t('Olá')}</h1>
      <p>Current Language: {language}</p>
      <button onClick={() => setLanguage('en')}>English</button>
      <button onClick={() => setLanguage('pt')}>Português</button>
    </div>
  );
};

export default ExampleComponent;
```

### Auto-Detect Browser Language

If you pass the autoDetectLanguage prop to TranslatorProvider, the library will detect the user's browser language automatically. The fallback language will be the defaultLanguage.

```typescript
ReactDOM.render(
  <TranslatorProvider
    translations={translations} 
    defaultLanguage="en" 
    autoDetectLanguage 
  >
    <App />
  </TranslatorProvider>,
  document.getElementById('root')
);
```

For example:

- Browser language: pt-BR
- Default language: en

The app will automatically use English as default if not provided or browser language not available.

### Persisting the Selected Language

To persist the selected language across page reloads, use the persist as true and the optional persistKey prop. This will store the selected language in localStorage under the specified key.

```typescript
ReactDOM.render(
  <TranslatorProvider
    translations={translations}
    persist
    persistKey="myAppLanguage" 
  >
    <App />
  </TranslatorProvider>,
  document.getElementById('root')
);
```

---

## API Reference

### `TranslatorProvider` Props

|Prop|Type|Default Value|Description|
|---|---|---|---|
|`translations`|`Record<string>[]`|Required|The translations JSON file or object.|
|`defaultLanguage`|`string`|`'en'`|The fallback/default language.|
|`autoDetectLanguage`|`boolean`|`false`|If true, detects the user's browser language automatically.|
|`persist`|`boolean`|`false`|If provided, persists the language in `localStorage` with persistKey.|
|`persistKey`|`string`|`language`|If provided, customize the `localStorage` key.|

### `useTranslator` Hook

The `useTranslator` hook provides the following:

|Property|Type|Description|
|---|---|---|
|`t`|`(text: string) => string`|Function to get the translated text for a given key.|
|`language`|`string`|The currently active language.|
|`languages`|`string[]`|The currently available languages.|
|`setLanguage`|`(lang: string) => void`|Function to change the current language.|

---

## Translation File Generation CLI

vbss-translator includes a CLI tool to automatically generate translation index files from multiple translation JSON files scattered across your project. This eliminates manual maintenance and ensures your translation index is always up-to-date.

### Quick Start

1. **Install vbss-translator** (if not already installed):

   ```bash
   npm install vbss-translator
   ```

2. **Create translation files** in your project:

   ```json
   // src/components/button/translations.json
   {
     "en": "Click me",
     "pt": "Clique em mim"
   }
   ```

3. **Generate the index file**:

   ```bash
   npx vbss-translator generate
   ```

   Or add to your `package.json`:

   ```json
   {
     "scripts": {
       "generate-translations": "vbss-translator generate"
     }
   }
   ```

4. **Use the generated index** in your `TranslatorProvider`:

   ```typescript
   import translations from './src/translations/index.ts';
   
   <TranslatorProvider translations={translations}>
     <App />
   </TranslatorProvider>
   ```

### CLI Commands

#### Basic Usage

```bash
# Generate translations using default settings
npx vbss-translator generate

# Or use npm script
npm run generate-translations
```

#### Command Options

```bash
vbss-translator generate [options]

Options:
  --pattern <glob>           Glob pattern to find translation files (default: "src/**/translations.json")
  --output <path>            Output file path (default: "src/translations/index.ts")
  --format <ts|js|tsx>       Output format (default: "ts")
  --reference-language <lang> Language key to use for deduplication (default: first language found)
  --config <path>            Path to config file (default: "vbss-translator.config.json")
  --watch, -w                Enable watch mode for automatic regeneration
  --help, -h                 Show help message
```

#### Examples

```bash
# Custom pattern and output
npx vbss-translator generate --pattern "src/**/*.json" --output "src/i18n/index.ts"

# Generate JavaScript instead of TypeScript
npx vbss-translator generate --format js --output "src/translations/index.js"

# Use Spanish as reference language for deduplication
npx vbss-translator generate --reference-language es

# Watch mode for development
npx vbss-translator generate --watch
```

### Configuration File

Create a `vbss-translator.config.json` file in your project root to avoid passing options every time:

```json
{
  "pattern": "src/**/translations.json",
  "outputPath": "src/translations/index.ts",
  "outputFormat": "ts",
  "referenceLanguage": "en"
}
```

**Configuration Options:**

- `pattern` (string): Glob pattern to find translation files. Supports `**` for recursive directory traversal.
- `outputPath` (string): Path where the generated index file will be created.
- `outputFormat` (`"ts"` | `"js"` | `"tsx"`): Format of the generated file.
  - `"ts"`: TypeScript with interface definitions
  - `"js"`: JavaScript without types
  - `"tsx"`: TypeScript (same as `ts`, for React component files)
- `referenceLanguage` (string, optional): Language key to use for deduplication. Defaults to the first language found in translation files.

**Note:** CLI flags always override config file settings.

### Watch Mode

Watch mode automatically regenerates the translation index when translation files are added, modified, or deleted:

```bash
npx vbss-translator generate --watch
```

In watch mode, the tool:

- Monitors all files matching your search pattern
- Regenerates the index file automatically on changes
- Continues running until stopped (Ctrl+C)
- Perfect for development workflows

### Translation File Format

Translation files can be either:

1. **Single object** (automatically wrapped in array):

   ```json
   {
     "en": "Hello",
     "pt": "Olá",
     "es": "Hola"
   }
   ```

2. **Array of objects**:

   ```json
   [
     {
       "en": "Hello",
       "pt": "Olá"
     },
     {
       "en": "World",
       "pt": "Mundo"
     }
   ]
   ```

**Important Requirements:**

- All translation files must have the same language keys
- All values must be strings
- Files must be valid JSON

### Programmatic API

You can also use the generation API programmatically in your code:

```typescript
import { generate } from 'vbss-translator';
import type { GeneratorOptions } from 'vbss-translator';

const options: GeneratorOptions = {
  pattern: 'src/**/translations.json',
  outputPath: 'src/translations/index.ts',
  outputFormat: 'ts',
  referenceLanguage: 'en',
};

const result = await generate(options);

if (result.success) {
  console.log(`Generated ${result.translationsGenerated} translations from ${result.filesFound} files`);
} else {
  console.error('Generation failed:', result.errors);
}
```

### Generated File Structure

The generated index file includes:

1. **Import statements** for all discovered translation files
2. **TypeScript interface** (when format is `ts` or `tsx`):

   ```typescript
   export interface Translation {
     [key: string]: string;
   }
   ```

3. **Aggregated translations array** with deduplication:

   ```typescript
   const allTranslations: Translation[] = [
     ...translations0,
     ...translations1,
     // ...
   ];
   
   const uniqueTranslations = allTranslations.filter(
     (translation, index, self) => 
       index === self.findIndex((t) => t.en === translation.en)
   );
   ```

4. **Default export**:

   ```typescript
   export default uniqueTranslations;
   ```

### Best Practices

1. **Organize translations by feature/component**: Keep translation files close to where they're used
2. **Use consistent naming**: Name all translation files `translations.json` for easy discovery
3. **Validate early**: Run generation in your CI/CD pipeline to catch issues early
4. **Use watch mode in development**: Enable `--watch` during development for automatic updates
5. **Version control generated files**: Include generated index files in git for consistency across team

For more detailed examples and advanced usage, visit [ui.vbss.io/tools/vbss-translator](https://ui.vbss.io/tools/vbss-translator).

---

## Feedback

If you enjoy using this package or find any issues, please give us a ⭐ on GitHub or open an issue. We appreciate your support! 🚀

## Contributing

We welcome contributions! Feel free to open issues or submit pull requests.
