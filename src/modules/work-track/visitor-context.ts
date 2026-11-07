import { open, type CityResponse, type Reader } from "maxmind";
import { resolve } from "node:path";
import { isIP } from "node:net";

let reader: Promise<Reader<CityResponse>> | undefined;

export async function visitorContext(ip: string, ua: string, touchTablet: boolean) {
  const browser = /edg(?:e|a|ios)?\//i.test(ua) ? "Microsoft Edge"
    : /opr\/|opera/i.test(ua) ? "Opera"
    : /samsungbrowser\//i.test(ua) ? "Samsung Internet"
    : /firefox\/|fxios\//i.test(ua) ? "Firefox"
    : /chrome\/|crios\//i.test(ua) ? "Chrome"
    : /safari\//i.test(ua) ? "Safari" : "Unknown";
  const os = /iphone|ipad|ipod/i.test(ua) || touchTablet ? "iOS / iPadOS"
    : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows"
    : /cros/i.test(ua) ? "ChromeOS" : /macintosh|mac os x/i.test(ua) ? "macOS"
    : /linux/i.test(ua) ? "Linux" : "Unknown";
  const context = { browser, os, country: "", city: "" };
  if (!isIP(ip)) return context;
  try {
    reader ??= open<CityResponse>(process.env.JOURNEY_GEOIP_PATH || resolve(process.cwd(), "../../../config/dbip-city.mmdb"))
      .catch(error => { reader = undefined; throw error; });
    const location = (await reader).get(ip);
    context.country = location?.country?.iso_code || "";
    context.city = location?.city?.names?.en || "";
  } catch { /* Location lookup must not interrupt collection. */ }
  return context;
}
