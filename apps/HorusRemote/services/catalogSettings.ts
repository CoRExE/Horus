export function normalizeCatalogUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error('Saisissez une URL HTTP ou HTTPS valide.');
  }
}

export function createCatalogSettings(set: (state: { apiUrl: string }) => void) {
  return {
    apiUrl: '',
    setApiUrl: (value: string) => set({ apiUrl: normalizeCatalogUrl(value) }),
  };
}
