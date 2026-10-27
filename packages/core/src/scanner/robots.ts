// A small robots.txt parser following RFC 9309: the most specific matching
// user-agent group wins (ours, else "*"), the longest matching rule wins, and
// Allow beats Disallow on a tie.

export const BOT_TOKEN = "a11yagentbot";

export interface RobotsRules {
  isAllowed(pathWithQuery: string): boolean;
  sitemaps: string[];
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

export function parseRobots(text: string, botToken = BOT_TOKEN): RobotsRules {
  const groups = new Map<string, Rule[]>();
  const sitemaps: string[] = [];
  let current: string[] = [];
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group.
      if (!lastWasAgent) current = [];
      const agent = value.toLowerCase();
      current.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "sitemap" && value) {
      sitemaps.push(value);
    } else if ((field === "allow" || field === "disallow") && current.length > 0) {
      // An empty Disallow means "allow everything" and adds no rule.
      if (!value) continue;
      const rule = { allow: field === "allow", pattern: value, regex: toRegex(value) };
      for (const agent of current) groups.get(agent)?.push(rule);
    }
  }

  const rules = groups.get(botToken.toLowerCase()) ?? groups.get("*") ?? [];

  return {
    sitemaps,
    isAllowed(pathWithQuery: string): boolean {
      let best: Rule | undefined;
      for (const rule of rules) {
        if (!rule.regex.test(pathWithQuery)) continue;
        const longer = !best || rule.pattern.length > best.pattern.length;
        const tieAllow = best && rule.pattern.length === best.pattern.length && rule.allow;
        if (longer || tieAllow) best = rule;
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true, sitemaps: [] };
