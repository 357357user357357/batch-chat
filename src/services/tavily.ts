/**
 * Minimal Tavily web search client. The user stores their own API key in the
 * app's secure storage and it is used only at runtime for live web lookups.
 */

import { getStoredTavilyApiKey } from "@/services/key-store";

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

export type TavilySearchOptions = {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  includeAnswer?: boolean;
};

export function getEnvTavilyApiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_TAVILY_API_KEY;
  return key || undefined;
}

export async function resolveTavilyApiKey(): Promise<string | undefined> {
  const envKey = getEnvTavilyApiKey();
  if (envKey) return envKey;

  try {
    const stored = await getStoredTavilyApiKey();
    return stored ?? undefined;
  } catch {
    return undefined;
  }
}

export async function searchWeb(
  query: string,
  options: TavilySearchOptions = {},
): Promise<TavilySearchResult[]> {
  const key = await resolveTavilyApiKey();
  if (!key) {
    throw new Error(
      "No Tavily API key configured. Save your Tavily key in the app settings first.",
    );
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: options.maxResults ?? 3,
      search_depth: options.searchDepth ?? "basic",
      include_answer: options.includeAnswer ?? true,
    }),
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text();
    }
    throw new Error(
      `Tavily request failed with HTTP ${response.status}${detail ? `: ${JSON.stringify(detail)}` : ""}`,
    );
  }

  const payload = (await response.json()) as {
    answer?: string;
    results?: {
      title?: string;
      url?: string;
      content?: string;
      snippet?: string;
      score?: number;
    }[];
  };

  const items = Array.isArray(payload.results) ? payload.results : [];
  return items
    .map((item) => ({
      title: item.title ?? "Untitled result",
      url: item.url ?? "",
      content: item.content ?? item.snippet ?? "",
      score: item.score,
    }))
    .filter((item) => item.url || item.content);
}

export function webSearchContext(
  query: string,
  results: TavilySearchResult[],
): string {
  const searchedAt = new Date().toLocaleString([], {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (!results.length) {
    return `Web search results for "${query}" (searched at ${searchedAt}): none.`;
  }

  const summary = results
    .map((result, index) => {
      const snippet = result.content.trim().replace(/\s+/g, " ");
      return `${index + 1}. ${result.title}\n   ${result.url}\n   ${snippet.slice(0, 280)}${snippet.length > 280 ? "…" : ""}`;
    })
    .join("\n\n");

  return (
    `Web search results for "${query}" (searched at ${searchedAt} — snippets ` +
    "may be outdated; use the Current date and time from this system prompt " +
    "as 'now', never the times found inside pages):\n\n" +
    summary
  );
}
