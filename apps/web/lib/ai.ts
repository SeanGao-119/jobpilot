export type AiProviderName = "deepseek" | "openai-compatible";

export type AiJsonRequest = {
  system: string;
  user: string;
  temperature?: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function aiProviderName(): AiProviderName {
  const provider = (process.env.AI_PROVIDER || "deepseek").trim().toLowerCase();
  if (provider === "deepseek") return "deepseek";
  return "openai-compatible";
}

export async function generateJson<T>(request: AiJsonRequest): Promise<T> {
  const provider = aiProviderName();
  const apiKey = provider === "deepseek"
    ? requiredEnv("DEEPSEEK_API_KEY")
    : requiredEnv("AI_API_KEY");
  const baseUrl = provider === "deepseek"
    ? (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com")
    : requiredEnv("AI_BASE_URL");
  const model = provider === "deepseek"
    ? (process.env.DEEPSEEK_MODEL || "deepseek-chat")
    : requiredEnv("AI_MODEL");

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: request.temperature ?? 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI provider request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned no content");

  return JSON.parse(stripJsonFence(content)) as T;
}
