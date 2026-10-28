// Reduces an HTML page to the signals useful for event extraction, using the
// Workers-native streaming HTMLRewriter (no DOM library needed).

export interface PageContent {
  title: string;
  meta: Record<string, string>;
  /** Schema.org Event objects found in JSON-LD blocks. */
  jsonLdEvents: unknown[];
  text: string;
}

export const MAX_TEXT_CHARS = 15_000;
const META_KEYS = /^(og:|twitter:|event:|description$|keywords$|date|start|end)/i;
// Elements whose text is never visible content. (Not <head>: its end tag is often implicit,
// which would leave the skip counter stuck.)
const SKIPPED_TAGS = "script, style, noscript, svg, template, iframe";

export async function extractPageContent(html: string): Promise<PageContent> {
  let title = "";
  const meta: Record<string, string> = {};
  const jsonLdBlocks: string[] = [];
  let currentJsonLd = "";
  const textParts: string[] = [];
  let textLength = 0;
  let skipDepth = 0;

  const rewriter = new HTMLRewriter()
    .on("title", {
      text(chunk) {
        if (title.length < 300) title += chunk.text;
      },
    })
    .on("meta", {
      element(el) {
        const key = el.getAttribute("property") ?? el.getAttribute("name") ?? el.getAttribute("itemprop");
        const content = el.getAttribute("content");
        if (key && content && META_KEYS.test(key) && !(key in meta)) meta[key] = content.slice(0, 1000);
      },
    })
    .on('script[type="application/ld+json"]', {
      text(chunk) {
        currentJsonLd += chunk.text;
        if (chunk.lastInTextNode) {
          jsonLdBlocks.push(currentJsonLd);
          currentJsonLd = "";
        }
      },
    })
    .on(SKIPPED_TAGS, {
      element(el) {
        skipDepth++;
        el.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .onDocument({
      text(chunk) {
        if (skipDepth > 0 || textLength >= MAX_TEXT_CHARS) return;
        const t = chunk.text;
        if (t.trim()) {
          textParts.push(t);
          textLength += t.length;
        }
      },
    });

  await rewriter.transform(new Response(html)).text();

  return {
    title: decodeEntities(title).replace(/\s+/g, " ").trim(),
    meta: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, decodeEntities(v)])),
    jsonLdEvents: jsonLdBlocks.flatMap(findEvents),
    text: decodeEntities(textParts.join(" ")).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS),
  };
}

/** Finds objects whose @type includes "Event" (e.g. Event, EducationEvent, BusinessEvent) in a JSON-LD block. */
export function findEvents(block: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(block);
  } catch {
    return [];
  }
  const found: unknown[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 5 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    const obj = node as Record<string, unknown>;
    const types = ([] as unknown[]).concat(obj["@type"] ?? []);
    if (types.some((t) => typeof t === "string" && /Event$/.test(t))) {
      found.push(obj);
      return;
    }
    if (obj["@graph"]) visit(obj["@graph"], depth + 1);
  };
  visit(data, 0);
  return found;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** HTMLRewriter yields raw text, so decode the common entities. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}
