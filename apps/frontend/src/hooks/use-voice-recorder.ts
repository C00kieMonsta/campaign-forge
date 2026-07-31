import { useCallback, useEffect, useRef, useState } from "react";

// Voice notes are dictated in the chat, then stored as documents and transcribed. Recording is
// capped so a forgotten open mic can't produce an untranscribable file (the transcription API
// rejects payloads over 25 MB; opus at this bitrate leaves ample headroom for 30 minutes).
export const MAX_RECORDING_SECONDS = 30 * 60;

/** Preferred container, in order — Safari has no webm/opus encoder, so it falls back to mp4. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus"
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export interface VoiceRecorder {
  isSupported: boolean;
  isRecording: boolean;
  /** Seconds elapsed in the current recording. */
  elapsed: number;
  start: () => Promise<void>;
  /** Stops and resolves with the recorded audio as a File (null if nothing was captured). */
  stop: () => Promise<File | null>;
  /** Stops and discards the recording. */
  cancel: () => void;
}

/**
 * MediaRecorder wrapper for dictating a voice note. Owns the mic stream and guarantees it is
 * released on stop/cancel/unmount, so the browser's recording indicator never lingers.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set when stop() is awaiting the recorder's final dataavailable/stop events.
  const settleRef = useRef<((file: File | null) => void) | null>(null);

  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setIsRecording(false);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const settle = settleRef.current;
      settleRef.current = null;
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      teardown();
      if (!settle) return; // cancelled — discard
      settle(
        blob.size === 0
          ? null
          : new File([blob], `voice-note.${extensionFor(type)}`, { type })
      );
    };

    recorderRef.current = recorder;
    streamRef.current = stream;
    setElapsed(0);
    setIsRecording(true);
    recorder.start();

    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        // Hard cap: stop the recorder itself. A pending stop() still receives the audio.
        if (
          next >= MAX_RECORDING_SECONDS &&
          recorderRef.current?.state === "recording"
        ) {
          recorderRef.current.stop();
        }
        return next;
      });
    }, 1000);
  }, [teardown]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      return Promise.resolve(null);
    }
    return new Promise<File | null>((resolve) => {
      settleRef.current = resolve;
      recorder.stop();
    });
  }, [teardown]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    settleRef.current = null; // onstop discards when there is nothing to settle
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else teardown();
  }, [teardown]);

  return {
    isSupported: typeof MediaRecorder !== "undefined",
    isRecording,
    elapsed,
    start,
    stop,
    cancel
  };
}

/** mm:ss for a duration in seconds (voice-note length + live recording timer). */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
