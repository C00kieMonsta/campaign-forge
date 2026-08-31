import { audioExtension } from "../voice.service";

/**
 * The one pure decision in the voice path, and the one that breaks the feature silently if it is
 * wrong: the transcription API dispatches on the FILENAME, not the mime type, so a Safari recording
 * sent as `message.webm` is rejected even though the bytes are valid mp4.
 *
 * Kept in step with extensionFor() in the frontend's use-voice-recorder. The two must agree, or the
 * object is stored under one extension and transcribed under another.
 */
describe("audioExtension", () => {
  it.each([
    // What MediaRecorder actually reports, codecs parameter included.
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    // Safari. The mapping that matters: mp4 must become m4a, not mp4.
    ["audio/mp4", "m4a"],
    ["audio/mp4;codecs=mp4a.40.2", "m4a"],
    ["audio/m4a", "m4a"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/ogg", "ogg"],
    ["audio/mpeg", "mp3"],
    ["audio/mp3", "mp3"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"]
  ])("maps %s to .%s", (contentType, ext) => {
    expect(audioExtension(contentType)).toBe(ext);
  });

  it("is case-insensitive, because a browser may send AUDIO/MP4", () => {
    expect(audioExtension("AUDIO/MP4")).toBe("m4a");
  });

  it("falls back to webm for an unrecognised type rather than throwing", () => {
    // A new codec must degrade to "try it as webm", not to a failed request: the recording is
    // already in S3 and already paid for by the time this runs.
    expect(audioExtension("audio/flac")).toBe("webm");
    expect(audioExtension("")).toBe("webm");
  });
});
