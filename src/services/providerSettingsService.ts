import {
  defaultProviderSettings,
  getProviderDefaults,
  isValidProviderId,
  isValidUrl,
  ProviderId,
  ProviderSettings,
  PROVIDER_DEFINITIONS,
  SETTINGS_STORAGE_KEY
} from './providerConfig';

export interface ProviderValidationErrors {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export function hydrateProviderSettings(): ProviderSettings {
  if (typeof window === 'undefined') {
    return defaultProviderSettings;
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return defaultProviderSettings;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProviderSettings>;
    if (!parsed.provider || !isValidProviderId(parsed.provider)) {
      return defaultProviderSettings;
    }

    const defaults = getProviderDefaults(parsed.provider);
    return {
      provider: parsed.provider,
      model: parsed.model?.trim() || defaults.model,
      baseUrl: parsed.baseUrl?.trim() || defaults.baseUrl
    };
  } catch {
    return defaultProviderSettings;
  }
}

export function persistProviderSettings(settings: ProviderSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function validateProviderSettings(settings: ProviderSettings, apiKey: string): ProviderValidationErrors {
  const errors: ProviderValidationErrors = {};
  const definition = PROVIDER_DEFINITIONS[settings.provider as ProviderId];

  if (definition.requiresApiKey && !apiKey.trim()) {
    errors.apiKey = `${definition.label} API key is required.`;
  }

  if (!settings.model.trim()) {
    errors.model = 'Model is required.';
  }

  if (!settings.baseUrl.trim()) {
    errors.baseUrl = 'Base URL is required.';
  } else if (!isValidUrl(settings.baseUrl)) {
    errors.baseUrl = 'Enter a valid http(s) URL.';
  }

  return errors;
}
