import { MAX_VOICE_MESSAGE_BYTES } from "@packages/types";
import { api } from "./api";

/**
 * Uploads a recording straight to S3 and asks for its transcript.
 *
 * Same route as a document: the bytes never traverse the API, which nginx caps at 10 MB in
 * production. Two round trips rather than one POST of the audio, deliberately — transcription is
 * the slow step and it runs against an object that already exists, so a failed transcribe is
 * retried without re-uploading the recording.
 */
export async function uploadVoiceMessage(
  conversationId: string,
  file: File,
  durationSeconds: number
): Promise<{
  audioId: string;
  transcript: string;
  durationSeconds: number | null;
}> {
  if (file.size > MAX_VOICE_MESSAGE_BYTES) {
    throw new Error("too_large");
  }
  // MediaRecorder always sets a type; the fallback is for a browser that somehow does not.
  const contentType = file.type || "audio/webm";
  const slot = await api.lex.voice.presign(conversationId, {
    contentType,
    size: file.size,
    durationSeconds
  });

  const put = await fetch(slot.uploadUrl, {
    method: "PUT",
    // Exactly what the URL was signed for. S3 verifies this against the signature, so neither side
    // may normalise the codecs parameter alone.
    headers: { "Content-Type": slot.contentType },
    body: file
  });
  if (!put.ok) {
    // Release the reserved row and its object, or an interrupted PUT leaves a draft behind.
    void api.lex.voice.discard(slot.audio.id).catch(() => undefined);
    throw new Error(`Voice upload failed: ${put.status}`);
  }

  const result = await api.lex.voice.transcribe(slot.audio.id);
  return {
    audioId: slot.audio.id,
    transcript: result.transcript,
    durationSeconds: result.durationSeconds ?? durationSeconds
  };
}
