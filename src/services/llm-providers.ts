/**
 * Multi-provider LLM settings.
 *
 * Any OpenAI-compatible endpoint can be used instead of (or as a fallback
 * for) OpenRouter — e.g. Fastrouter, Together, Groq, or a local LM Studio.
 * The configuration mirrors the server's TOML:
 *
 *   default_text_model = "z-ai/glm-5.3-flash"
 *   provider = "openai"
 *
 *   [providers.openai]
 *   base_url = "https://api.fastrouter.ai/v1"
 *   model = "z-ai/glm-5.3-flash"
 *
 * The API key is stored separately in secure storage (`key-store.ts`) using
 * the same "provider_ascii_id" identifier, so it never lives in AsyncStorage
 * backups.
 */
import { loadJSON, saveJSON } from "@/services/storage";

const PROVIDER_SETTINGS_KEY = "llm.providers.v1";

/** Built-in OpenRouter / built-in OpenAI-compatible provider ids. */
export const PROVIDER_OPENROUTER = "openrouter";
export const PROVIDER_OPENAI = "openai";

export type ProviderSettings = {
  /** Stable ASCII id, e.g. "openrouter" or "openai" (key reference). */
  id: string;
  /** Human-readable label shown in the UI. */
  name: string;
  /** OpenAI-compatible base URL (must include the version prefix). */
  base_url: string;
  /** Preferred model id for this provider. */
  model: string;
};

export type LlmProviderConfig = {
  /** Currently selected provider id. */
  provider: string;
  providers: Record<string, ProviderSettings>;
};

export const FALLBACK_PROVIDER_ID = PROVIDER_OPENROUTER;

export const FALLBACK_LLM_CONFIG: LlmProviderConfig = {
  provider: PROVIDER_OPENROUTER,
  providers: {
    [PROVIDER_OPENROUTER]: {
      id: PROVIDER_OPENROUTER,
      name: "OpenRouter",
      base_url: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-chat-v3.1:free",
    },
    [PROVIDER_OPENAI]: {
      id: PROVIDER_OPENAI,
      name: "Fastrouter (OpenAI-compatible)",
      base_url: "https://api.fastrouter.ai/v1",
      model: "z-ai/glm-5.3-flash",
    },
  },
};

/** Reads the whole config, filling any missing pieces from the fallback. */
export async function getLlmConfig(): Promise<LlmProviderConfig> {
  const stored = await loadJSON<Partial<LlmProviderConfig> | null>(
    PROVIDER_SETTINGS_KEY,
    null,
  );
  const merged: LlmProviderConfig = {
    provider: stored?.provider ?? FALLBACK_LLM_CONFIG.provider,
    providers: { ...FALLBACK_LLM_CONFIG.providers },
  };
  for (const [id, settings] of Object.entries(stored?.providers ?? {})) {
    if (settings && typeof settings.id === "string" && settings.id) {
      merged.providers[id] = {
        id: settings.id,
        name: settings.name || id,
        base_url: settings.base_url || FALLBACK_LLM_CONFIG.providers[id]?.base_url || "",
        model: settings.model || FALLBACK_LLM_CONFIG.providers[id]?.model || "",
      };
    }
  }
  if (!merged.providers[merged.provider]) {
    merged.provider = FALLBACK_PROVIDER_ID;
  }
  return merged;
}

/** Returns just the currently selected provider's settings (or fallback). */
export async function getActiveProvider(): Promise<ProviderSettings> {
  const config = await getLlmConfig();
  return (
    config.providers[config.provider] ?? FALLBACK_LLM_CONFIG.providers[FALLBACK_PROVIDER_ID]
  );
}

/** Saves the whole config, replacing any previous providers. */
export async function saveLlmConfig(config: LlmProviderConfig): Promise<void> {
  await saveJSON(PROVIDER_SETTINGS_KEY, config);
}

/** Updates (or adds) a single provider entry and keeps the selection stable. */
export async function upsertProvider(settings: ProviderSettings): Promise<void> {
  const config = await getLlmConfig();
  config.providers[settings.id] = settings;
  await saveLlmConfig(config);
}

/** Switches the active provider (must exist). */
export async function setActiveProvider(id: string): Promise<void> {
  const config = await getLlmConfig();
  if (config.providers[id]) {
    config.provider = id;
    await saveLlmConfig(config);
  }
}

/** Deletes a provider entry; if it was active, falls back to the default. */
export async function removeProvider(id: string): Promise<void> {
  const config = await getLlmConfig();
  delete config.providers[id];
  if (config.provider === id) {
    config.provider = FALLBACK_PROVIDER_ID;
  }
  await saveLlmConfig(config);
}
