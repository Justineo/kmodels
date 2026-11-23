/** Parse RFC 9110 Accept-Encoding header and return true iff gzip is permitted with q > 0. */
export function acceptsGzipEncoding(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  if (raw.trim().length === 0) return false;
  let gzipQuality: number | undefined;
  let wildcardQuality: number | undefined;
  for (const part of raw.split(",")) {
    const [encodingRaw, ...params] = part.split(";");
    const encoding = encodingRaw?.trim().toLowerCase();
    if (!encoding) continue;
    let quality = 1;
    for (const param of params) {
      const match = param.trim().match(/^q\s*=\s*([0-9]+(?:\.[0-9]+)?)$/i);
      if (match !== null) {
        quality = Number(match[1]);
        break;
      }
    }
    if (encoding === "gzip" || encoding === "x-gzip") {
      gzipQuality = quality;
    } else if (encoding === "*") {
      wildcardQuality = quality;
    }
  }
  if (gzipQuality !== undefined) return gzipQuality > 0;
  return wildcardQuality !== undefined && wildcardQuality > 0;
}
