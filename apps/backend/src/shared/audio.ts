/**
 * The extension the transcription API dispatches on. It reads the FILENAME, not the mime type, so a
 * Safari recording sent as `message.webm` is rejected even though the bytes are valid mp4.
 *
 * Mirrors extensionFor() in the frontend's use-voice-recorder. The two must agree.
 */
export function audioExtension(contentType: string): string {
  const type = (contentType || "").toLowerCase();
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  return "webm";
}
