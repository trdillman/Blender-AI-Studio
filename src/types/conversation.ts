export interface Message {
  id: string;
  role: 'user' | 'model' | 'function';
  content?: string;
  parts?: any[];
  createdAt: string;
}

export interface ProviderConfig {
  model: string;
  systemInstruction: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  providerConfig: ProviderConfig;
  archived?: boolean;
}
