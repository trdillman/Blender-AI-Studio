export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'lmstudio';

export interface ProviderSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
}

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  defaultModel: string;
  defaultBaseUrl: string;
  helperText: string;
  requiresApiKey: boolean;
}

export const PROVIDER_DEFINITIONS: Record<ProviderId, ProviderDefinition> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    helperText: 'OpenAI expects a /v1 base URL and a valid API key.',
    requiresApiKey: true
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
    defaultBaseUrl: 'https://api.anthropic.com/v1/messages',
    helperText: 'Anthropic message API uses /v1/messages and requires an API key.',
    requiresApiKey: true
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    defaultModel: 'gemini-2.5-pro',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    helperText: 'Gemini calls are made against the Google Generative Language API base URL.',
    requiresApiKey: true
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    defaultModel: 'local-model',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    helperText: 'LM Studio is OpenAI-compatible and usually runs locally at 127.0.0.1:1234/v1.',
    requiresApiKey: false
  }
};

export const SETTINGS_STORAGE_KEY = 'blender_ai_provider_settings';

export const defaultProviderSettings: ProviderSettings = {
  provider: 'gemini',
  model: PROVIDER_DEFINITIONS.gemini.defaultModel,
  baseUrl: PROVIDER_DEFINITIONS.gemini.defaultBaseUrl
};

export function isValidProviderId(value: string): value is ProviderId {
  return value in PROVIDER_DEFINITIONS;
}

export function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getProviderDefaults(provider: ProviderId): Pick<ProviderSettings, 'model' | 'baseUrl'> {
  const definition = PROVIDER_DEFINITIONS[provider];
  return {
    model: definition.defaultModel,
    baseUrl: definition.defaultBaseUrl
  };
}
