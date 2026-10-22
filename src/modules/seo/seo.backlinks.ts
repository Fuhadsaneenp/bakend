import { parse } from "parse5";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { ApiError } from "../../lib/errors.js";
// Fail closed: only global IPv4 endpoints. Pin the resolved address to prevent DNS rebinding.
export function publicIPv4(ip: string) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
export async function verifyBacklink(source: string, target: string) {
  const url = new URL(source);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new ApiError(400, "Verification requires a public HTTPS URL");
  const addresses = (await dns.lookup(url.hostname, { all: true })).filter(
    (a) => a.family === 4,
  );
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new ApiError(400, "Verification requires a public IPv4 host");
  const html = await new Promise<string>((resolve, reject) => {
    const request = https.get(
      url,
      {
        lookup: (_host, _opts, cb) => cb(null, addresses[0].address, 4),
        headers: { "User-Agent": "STEMS-SEO-LinkVerifier/1.0" },
        timeout: 10000,
      },
      (r) => {
        if (
          r.statusCode !== 200 ||
          !r.headers["content-type"]?.includes("text/html")
        ) {
          r.resume();
          resolve("");
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        r.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            request.destroy(new Error("HTML exceeds verification limit"));
            return;
          }
          chunks.push(chunk);
        });
        r.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        r.on("error", reject);
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Verification timed out")),
    );
    request.on("error", reject);
  });
  return findBacklink(html, source, target);
}
export function findBacklink(html: string, source: string, target: string) {
  const document = parse(html);
  const links: any[] = [];
  function walk(node: any) {
    if (node.tagName === "a") links.push(node);
    // Templates and script contents are not rendered anchors.
    for (const child of node.childNodes || []) walk(child);
  }
  walk(document);
  for (const anchor of links) {
    const attrs = Object.fromEntries(
      anchor.attrs.map((a: any) => [a.name, a.value]),
    );
    if (!attrs.href) continue;
    let link;
    try {
      link = new URL(attrs.href, source);
    } catch {
      continue;
    }
    if (link.href === new URL(target).href)
      return {
        result: "PRESENT",
        attributes: String(attrs.rel || "")
          .toLowerCase()
          .split(/\s+/)
          .filter((x) => ["nofollow", "sponsored", "ugc"].includes(x)),
        checkedAt: new Date().toISOString(),
      };
  }
  return {
    result: "INCONCLUSIVE",
    attributes: [],
    checkedAt: new Date().toISOString(),
  };
}
