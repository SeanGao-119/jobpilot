import { createHash } from "node:crypto";

export type JobPlatform = "seek" | "linkedin" | "zeil" | "trademe";
export type OpportunityKind = "job" | "recruiter" | "network";

export type ParsedJobPosting = {
  title: string | null;
  company: string | null;
  location: string | null;
  employmentType: string | null;
  salaryText: string | null;
  description: string | null;
  postedAt: string | null;
  expiresAt: string | null;
};

const PLATFORM_HOSTS: Record<JobPlatform, string[]> = {
  seek: ["seek.co.nz", "seek.com"],
  linkedin: ["linkedin.com"],
  zeil: ["zeil.com"],
  trademe: ["trademe.co.nz"],
};

function hostMatches(host: string, root: string) {
  return host === root || host.endsWith(`.${root}`);
}

export function detectPlatform(value: string): { platform: JobPlatform; url: URL } {
  const url = new URL(value.trim());
  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    throw new Error("Only HTTP and HTTPS opportunity URLs are supported.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  for (const [platform, roots] of Object.entries(PLATFORM_HOSTS) as Array<[JobPlatform, string[]]>) {
    if (roots.some((root) => hostMatches(host, root))) return { platform, url };
  }
  throw new Error("Use a SEEK, LinkedIn, ZEIL or Trade Me Jobs URL.");
}

export function sourceForPlatform(platform: JobPlatform, automatic = false) {
  if (platform === "seek") return automatic ? "seek_email" : "seek_url";
  if (platform === "linkedin") return automatic ? "linkedin_email" : "linkedin_url";
  if (platform === "zeil") return "zeil_url";
  return "trademe_url";
}

export function externalIdForUrl(platform: JobPlatform, url: URL) {
  const patterns: Record<JobPlatform, RegExp[]> = {
    seek: [/\/job\/(\d+)/i],
    linkedin: [/\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/i, /[?&]currentJobId=(\d+)/i],
    zeil: [/\/jobs?\/([^/?#]+)/i],
    trademe: [/\/listing\/(\d+)/i, /\/jobs\/[^/?#]+\/(\d+)/i],
  };
  const value = `${url.pathname}${url.search}`;
  for (const pattern of patterns[platform]) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return createHash("sha256").update(`${platform}:${url.origin}${url.pathname}${url.search}`).digest("hex").slice(0, 24);
}

export function canonicalJobUrl(platform: JobPlatform, url: URL, externalId: string) {
  if (platform === "seek" && /^\d+$/.test(externalId)) return `https://www.seek.co.nz/job/${externalId}`;
  if (platform === "linkedin" && /^\d+$/.test(externalId)) return `https://www.linkedin.com/jobs/view/${externalId}`;
  const canonical = new URL(url.toString());
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (/^(utm_|trk|tracking|ref|source)/i.test(key)) canonical.searchParams.delete(key);
  }
  return canonical.toString();
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|li|div|section|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const type = item["@type"];
  if (String(type).toLowerCase() === "jobposting" || (Array.isArray(type) && type.some((entry) => String(entry).toLowerCase() === "jobposting"))) {
    return item;
  }
  for (const child of Object.values(item)) {
    const found = findJobPosting(child);
    if (found) return found;
  }
  return null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function company(posting: Record<string, unknown>) {
  const organization = posting.hiringOrganization;
  if (organization && typeof organization === "object") {
    return text((organization as Record<string, unknown>).name);
  }
  return text(posting.company) ?? text(posting.companyName);
}

function location(posting: Record<string, unknown>) {
  let raw = posting.jobLocation;
  if (Array.isArray(raw)) raw = raw[0];
  if (!raw || typeof raw !== "object") return text(raw);
  const item = raw as Record<string, unknown>;
  const direct = text(item.name);
  if (direct) return direct;
  const address = item.address;
  if (!address || typeof address !== "object") return null;
  const fields = address as Record<string, unknown>;
  return [fields.addressLocality, fields.addressRegion, fields.addressCountry]
    .map(text)
    .filter(Boolean)
    .join(", ") || null;
}

function salary(posting: Record<string, unknown>) {
  const value = posting.baseSalary;
  if (!value || typeof value !== "object") return null;
  const salaryObject = value as Record<string, unknown>;
  const amount = salaryObject.value;
  if (!amount || typeof amount !== "object") return null;
  const fields = amount as Record<string, unknown>;
  const minimum = fields.minValue;
  const maximum = fields.maxValue;
  if (minimum == null && maximum == null) return null;
  return `${text(salaryObject.currency) ?? ""} ${minimum ?? ""}${minimum != null && maximum != null ? "–" : ""}${maximum ?? ""} ${text(fields.unitText) ?? ""}`.trim();
}

export function parseJobPostingHtml(html: string): ParsedJobPosting {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const posting = findJobPosting(JSON.parse(script[1].trim()));
      if (!posting) continue;
      const employmentType = Array.isArray(posting.employmentType)
        ? posting.employmentType.map(String).join(", ")
        : text(posting.employmentType);
      return {
        title: text(posting.title),
        company: company(posting),
        location: location(posting),
        employmentType,
        salaryText: salary(posting),
        description: text(posting.description) ? stripHtml(String(posting.description)) : null,
        postedAt: text(posting.datePosted),
        expiresAt: text(posting.validThrough),
      };
    } catch {
      continue;
    }
  }
  const meta = (property: string) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i").exec(html)
      ?? new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, "i").exec(html);
    return match?.[1] ? stripHtml(match[1]) : null;
  };
  return {
    title: meta("og:title"),
    company: meta("og:site_name"),
    location: null,
    employmentType: null,
    salaryText: null,
    description: meta("og:description") ?? meta("description"),
    postedAt: null,
    expiresAt: null,
  };
}

export async function fetchPublicJobPosting(url: string): Promise<ParsedJobPosting> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 JobPilot/0.6",
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`The job page returned HTTP ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 3_000_000) throw new Error("The job page is too large to import safely.");
    const finalPlatform = detectPlatform(response.url).platform;
    const initialPlatform = detectPlatform(url).platform;
    if (finalPlatform !== initialPlatform) throw new Error("The job URL redirected to an unsupported platform.");
    return parseJobPostingHtml((await response.text()).slice(0, 3_000_000));
  } finally {
    clearTimeout(timeout);
  }
}
