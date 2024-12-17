# vbss-translator

A lightweight and customizable React translation hook to easily handle multilingual websites. Includes support for browser language auto-detection, local persistence of language, and customizable translation files.

---

## Features

- Auto-detect browser language to set the initial language.
- Persist selected language in local storage.
- Customizable and dynamic translation keys.
- Minimalistic integration with React via useTranslator hook.
- Flexible and developer-friendly API.

---

## Installation

Install the package using npm or yarn:

```bash
npm install react-simple-translator
```

or

```bash
yarn add react-simple-translator
```

---

## Usage

### Setup the `TranslatorProvider`

Create a JSON file for translations. For example: `translations.json`

```json
[
  {
    "en": {
      "greeting": "Hello",
      "goodbye": "Goodbye"
    },
    "pt": {
      "greeting": "Olá",
      "goodbye": "Adeus"
    }
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
import { useTranslator } from 'react-simple-translator';

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

The app will automatically use Portuguese as default if not provided or browser language not available.

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

### **`TranslatorProvider` Props**

|Prop|Type|Default Value|Description|
|---|---|---|---|
|`translations`|`Record<string>[]`|Required|The translations JSON file or object.|
|`defaultLanguage`|`string`|`'pt'`|The fallback/default language.|
|`autoDetectLanguage`|`boolean`|`false`|If true, detects the user's browser language automatically.|
|`persist`|`boolean`|`false`|If provided, persists the language in `localStorage` with persistKey.|
|`persistKey`|`string`|`language`|If provided, customize the `localStorage` key.|


### **`useTranslator` Hook**

The `useTranslator` hook provides the following:

|Property|Type|Description|
|---|---|---|
|`t`|`(text: string) => string`|Function to get the translated text for a given key.|
|`language`|`string`|The currently active language.|
|`languages`|`string[]`|The currently available languages.|
|`setLanguage`|`(lang: string) => void`|Function to change the current language.|

---

## Feedback

If you enjoy using this package or find any issues, please give us a ⭐ on GitHub or open an issue. We appreciate your support! 🚀

## Contributing

We welcome contributions! Feel free to open issues or submit pull requests.
