export type SearchHit = {
  title: string;
  source_url: string;
  snippet: string;
};

export type SearchProviderName = "serper" | "none";

export function searchProviderName(): SearchProviderName {
  return process.env.SERPER_API_KEY?.trim() ? "serper" : "none";
}

export async function searchWeb(query: string, count = 10): Promise<SearchHit[]> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return [];

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      q: query,
      gl: "nz",
      hl: "en",
      num: Math.min(Math.max(count, 1), 20),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Search provider request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const payload = await response.json() as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  return (payload.organic ?? [])
    .filter((item) => item.title && item.link)
    .map((item) => ({
      title: item.title!,
      source_url: item.link!,
      snippet: item.snippet ?? "",
    }));
}
