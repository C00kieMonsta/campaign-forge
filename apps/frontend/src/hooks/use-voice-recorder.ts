import { useCallback, useEffect, useRef, useState } from "react";

// Recording is capped so a forgotten open mic can't produce an untranscribable file (the
// transcription API rejects payloads over 25 MB; opus at this bitrate leaves ample headroom for
// 30 minutes).
export const MAX_RECORDING_SECONDS = 30 * 60;

/**
 * Below this a recording is a mis-tap, not a message: too short for speech-to-text to hear.
 *
 * Milliseconds, and checked against a wall clock rather than against `elapsed`. `elapsed` is the
 * display timer: it starts at 0 and its first tick is a full second in, so a real 900ms recording
 * reported 0 and a one-second threshold threw it away before it reached the network.
 */
export const MIN_VOICE_MS = 600;

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
  /**
   * How long the recording actually ran, in ms, from a wall clock.
   *
   * Separate from `elapsed`, which exists to be rendered and is therefore quantised to whole
   * seconds. Callers deciding whether a recording is real, or telling the server how long it is,
   * need the measured value. Frozen once the recorder stops, so it can be read after `stop()`.
   */
  durationMs: () => number;
  /** Stops and discards the recording. */
  cancel: () => void;
}

export interface VoiceRecorderOptions {
  /**
   * Called when the 30-minute cap stops the recorder by itself, with what was captured.
   *
   * Without a handler here the audio was silently thrown away: the cap called stop() on the
   * MediaRecorder, onstop found no pending settle, and returned. A forgotten open mic lost thirty
   * minutes of dictation and the UI just went back to the composer.
   */
  onAutoStop?: (file: File | null) => void;
}

/**
 * MediaRecorder wrapper for dictating a voice note. Owns the mic stream and guarantees it is
 * released on stop/cancel/unmount, so the browser's recording indicator never lingers.
 */
export function useVoiceRecorder(
  options: VoiceRecorderOptions = {}
): VoiceRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Read through a ref so the recorder's onstop closure never holds a stale callback: it is
  // created once per recording and may fire minutes later.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** Set when the cap stopped the recorder, so onstop can tell that from a cancel. */
  const cappedRef = useRef(false);
  const startedAtRef = useRef(0);
  /** Non-zero once stopped, so durationMs stops advancing after the fact. */
  const stoppedAtRef = useRef(0);

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
      stoppedAtRef.current = Date.now();
      const settle = settleRef.current;
      settleRef.current = null;
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      teardown();
      if (!settle) {
        // No pending stop(). Either the user cancelled, or the cap fired — and only the second has
        // audio worth handing back.
        if (cappedRef.current) {
          optionsRef.current.onAutoStop?.(
            blob.size === 0
              ? null
              : new File([blob], `voice-note.${extensionFor(type)}`, { type })
          );
        }
        return;
      }
      settle(
        blob.size === 0
          ? null
          : new File([blob], `voice-note.${extensionFor(type)}`, { type })
      );
    };

    recorderRef.current = recorder;
    streamRef.current = stream;
    cappedRef.current = false;
    startedAtRef.current = Date.now();
    stoppedAtRef.current = 0;
    setElapsed(0);
    setIsRecording(true);
    // No timeslice. A 5s timeslice was tried, to salvage a dictation from an iOS screen lock (the
    // page is frozen and the recorder yields nothing after resume). It is not worth it: it puts an
    // extra flush path in front of EVERY recording, and an empty blob here means stop() resolves
    // null and the send is dropped before it reaches the network. A rare partial loss is a better
    // trade than a common total one.
    recorder.start();

    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        // Hard cap: stop the recorder itself. A pending stop() still receives the audio.
        if (
          next >= MAX_RECORDING_SECONDS &&
          recorderRef.current?.state === "recording"
        ) {
          // Marked BEFORE stop(), so onstop can tell a cap from a cancel.
          cappedRef.current = true;
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
    cappedRef.current = false; // an explicit cancel is never an auto-stop
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else teardown();
  }, [teardown]);

  const durationMs = useCallback(
    () =>
      startedAtRef.current === 0
        ? 0
        : (stoppedAtRef.current || Date.now()) - startedAtRef.current,
    []
  );

  return {
    isSupported: typeof MediaRecorder !== "undefined",
    isRecording,
    elapsed,
    start,
    stop,
    durationMs,
    cancel
  };
}

/** mm:ss for a duration in seconds (voice-note length + live recording timer). */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
