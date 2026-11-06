/**
 * Content-Disposition header value for a downloadable filename. Sends both
 * an ASCII fallback (for user agents that don't support RFC 5987) and a
 * UTF-8 filename* form, since project/file names allow Unicode (e.g. Polish
 * characters) and a raw non-ASCII filename= can throw in some HTTP stacks.
 */
export function attachmentDisposition(
  baseName: string,
  extension: string,
): string {
  const asciiName = baseName.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${asciiName}.${extension}"; filename*=UTF-8''${encodeURIComponent(baseName)}.${extension}`;
}
