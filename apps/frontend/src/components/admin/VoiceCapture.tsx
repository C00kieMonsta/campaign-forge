import {
  MAX_ASSISTANT_UPLOAD_BYTES,
  MAX_ASSISTANT_VOICE_SECONDS
} from "@packages/types";
import { Button } from "@packages/ui";
import { Check, Loader2, Mic, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import {
  formatDuration,
  MIN_VOICE_MS,
  useVoiceRecorder
} from "@/hooks/use-voice-recorder";

interface Props {
  /** The recording, validated: long enough to hear, small enough to upload. */
  onRecorded: (file: File, durationSeconds: number) => void;
  disabled?: boolean;
  /** The caller is transcribing the last recording: shows a spinner instead of the mic. */
  busy?: boolean;
  maxSeconds?: number;
  /** A labelled button (dialogs) or a bare mic (composers). */
  variant?: "button" | "icon";
  className?: string;
}

/**
 * A mic button that becomes a recording bar, for the two assistants.
 *
 * Owns the recorder and the three ways a recording is dropped before it reaches the network (empty,
 * too short, too large), so each caller only receives a file worth sending. Transcription stays
 * with the caller: the campaign brief and the contact extraction go to different endpoints.
 *
 * Renders nothing where MediaRecorder is absent, so a browser without it simply has no mic.
 */
export default function VoiceCapture({
  onRecorded,
  disabled = false,
  busy = false,
  maxSeconds = MAX_ASSISTANT_VOICE_SECONDS,
  variant = "button",
  className = ""
}: Props) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const recorder = useVoiceRecorder({
    maxSeconds,
    // The cap stops the recorder by itself; what it captured is still a recording worth sending.
    onAutoStop: (file) => {
      if (file) onRecorded(file, maxSeconds);
    }
  });

  if (!recorder.isSupported) return null;

  const start = async () => {
    try {
      await recorder.start();
    } catch {
      toast({ title: t.voiceCapture.micDenied, variant: "destructive" });
    }
  };

  const finish = async () => {
    const file = await recorder.stop();
    const ms = recorder.durationMs();
    if (!file) {
      toast({ title: t.voiceCapture.empty, variant: "destructive" });
      return;
    }
    if (ms < MIN_VOICE_MS) {
      toast({ title: t.voiceCapture.tooShort, variant: "destructive" });
      return;
    }
    if (file.size > MAX_ASSISTANT_UPLOAD_BYTES) {
      toast({ title: t.voiceCapture.tooLarge, variant: "destructive" });
      return;
    }
    onRecorded(file, Math.round(ms / 1000));
  };

  if (recorder.isRecording) {
    return (
      <div
        className={`flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 ${className}`}
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
        <span className="hidden text-sm sm:inline">
          {t.voiceCapture.recording}
        </span>
        <span className="font-mono text-sm text-muted-foreground">
          {formatDuration(recorder.elapsed)} /{" "}
          {formatDuration(recorder.maxSeconds)}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={recorder.cancel}
        >
          <X className="h-3.5 w-3.5" />
          {t.voiceCapture.cancel}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void finish()}
          className="gradient-terracotta text-white"
        >
          <Check className="h-3.5 w-3.5" />
          {t.voiceCapture.done}
        </Button>
      </div>
    );
  }

  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => void start()}
        disabled={disabled || busy}
        title={t.voiceCapture.record}
        aria-label={t.voiceCapture.record}
        className={className}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void start()}
      disabled={disabled || busy}
      className={className}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
      {busy ? t.voiceCapture.transcribing : t.voiceCapture.record}
    </Button>
  );
}
