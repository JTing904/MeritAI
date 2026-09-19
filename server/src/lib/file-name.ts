/**
 * An upload's display name: the separate "fileName" form field when sent (UTF-8, from the app),
 * otherwise the part's filename, which some clients percent-encode (Expo encodes 「作业说明.pdf」 as
 * %E4%BD%9C…). Control characters are dropped and the name is cut to 255 characters. Only for showing:
 * storage keys never contain it.
 */
export function safeFileName(field: unknown, partName: string, fallback = "brief"): string {
  let name = typeof field === "string" && field.trim() ? field.trim() : partName;
  if (/%[0-9A-Fa-f]{2}/.test(name)) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // Not valid percent-encoding: keep it as sent.
    }
  }
  const printable = Array.from(name).filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f).join("");
  return printable.slice(0, 255) || fallback;
}

/** The lower-cased extension of a file name ("" without one). */
export function fileExtension(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
}
