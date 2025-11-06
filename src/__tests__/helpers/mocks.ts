let localStorageStorage: Record<string, string> = {};

export const localStorageMock = {
  getItem: jest.fn((key: string): string | null => {
    return localStorageStorage[key] ?? null;
  }),
  setItem: jest.fn((key: string, value: string): void => {
    localStorageStorage[key] = value;
  }),
  removeItem: jest.fn((key: string): void => {
    delete localStorageStorage[key];
  }),
  clear: jest.fn((): void => {
    localStorageStorage = {};
  }),
  storage: localStorageStorage,
};

export const setupLocalStorageMock = (): void => {
  Object.defineProperty(window, "localStorage", {
    writable: true,
    value: localStorageMock,
  });
};

export const resetLocalStorageMock = (): void => {
  localStorageStorage = {};
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
  setupLocalStorageMock();
};

export const setupNavigatorLanguageMock = (lang: string): void => {
  Object.defineProperty(window.navigator, "language", {
    writable: true,
    value: lang,
  });
};

export const resetNavigatorLanguageMock = (): void => {
  Object.defineProperty(window.navigator, "language", {
    writable: true,
    value: "en",
  });
};
