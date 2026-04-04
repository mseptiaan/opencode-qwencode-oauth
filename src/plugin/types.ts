import type { PluginInput } from "@opencode-ai/plugin";

export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
  resourceUrl?: string;
}

export interface NonOAuthAuthDetails {
  type: string;
  [key: string]: unknown;
}

export type AuthDetails = OAuthAuthDetails | NonOAuthAuthDetails;

export type GetAuth = () => Promise<AuthDetails>;

export interface ProviderModelCost {
  input: number;
  output: number;
  cache: {
    read: number;
    write: number;
  };
  experimentalOver200K?: {
    input: number;
    output: number;
    cache: {
      read: number;
      write: number;
    };
  };
}

export interface ProviderModel {
  cost?: ProviderModelCost;
  [key: string]: unknown;
}

export interface Provider {
  models?: Record<string, ProviderModel>;
}

export interface LoaderResult {
  apiKey: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export type PluginClient = PluginInput["client"];

export interface PluginContext {
  client: PluginClient;
  directory: string;
}

export type AuthPrompt =
  | {
      type: "text";
      key: string;
      message: string;
      placeholder?: string;
      validate?: (value: string) => string | undefined;
      condition?: (inputs: Record<string, string>) => boolean;
    }
  | {
      type: "select";
      key: string;
      message: string;
      options: Array<{ label: string; value: string; hint?: string }>;
      condition?: (inputs: Record<string, string>) => boolean;
    };

export type OAuthAuthorizationResult = { url: string; instructions: string } & (
  | {
      method: "auto";
      callback: () => Promise<Record<string, unknown>>;
    }
  | {
      method: "code";
      callback: (code: string) => Promise<Record<string, unknown>>;
    }
);

export interface AuthMethod {
  provider?: string;
  label: string;
  type: "oauth" | "api";
  prompts?: AuthPrompt[];
  authorize?: (
    inputs?: Record<string, string>,
  ) => Promise<OAuthAuthorizationResult>;
}

export interface PluginEventPayload {
  event: {
    type: string;
    properties?: unknown;
  };
}

export interface PluginResult {
  auth: {
    provider: string;
    loader: (
      getAuth: GetAuth,
      provider: Provider,
    ) => Promise<LoaderResult | Record<string, unknown>>;
    methods: AuthMethod[];
  };
  event?: (payload: PluginEventPayload) => void;
}
