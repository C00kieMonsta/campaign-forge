import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatDuration } from "@/hooks/use-voice-recorder";
import { api } from "@/lib/api";

/**
 * Plays back the recording behind a spoken turn.
 *
 * The URL is presigned and short-lived, so it is fetched on the first press rather than for every
 * bubble in a years-long thread, and re-fetched once if playback fails: a URL signed twenty minutes
 * ago is expired, not broken.
 *
 * Custom controls rather than `<audio controls>`, because this sits inside a coloured chat bubble
 * and the native widget cannot be themed to it. The element is still an `<audio>`, so the platform
 * handles the codec — Safari records mp4, everything else webm/opus.
 *
 * The duration comes from the SERVER, never from the element. A webm produced by MediaRecorder
 * carries no duration in its container, so Chrome reports Infinity for it and both the label and the
 * seek bar would be unusable.
 */
export default function VoiceMessagePlayer({
  audioId,
  durationSeconds,
  className
}: {
  audioId: string;
  durationSeconds: number | null;
  className?: string;
}) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retriedRef = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);

  // Nothing in this component should keep playing once the bubble scrolls out of the tree.
  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    []
  );

  const fetchUrl = useCallback(async () => {
    const res = await api.lex.voice.url(audioId);
    setUrl(res.url);
    return res.url;
  }, [audioId]);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    setFailed(false);
    if (!url) {
      setLoading(true);
      try {
        el.src = await fetchUrl();
      } catch {
        setFailed(true);
        return;
      } finally {
        setLoading(false);
      }
    }
    try {
      await el.play();
    } catch {
      setFailed(true);
    }
  }, [playing, url, fetchUrl]);

  /** One retry with a fresh URL: the usual cause is a signature that expired while the tab sat open. */
  const handleError = useCallback(() => {
    const el = audioRef.current;
    if (!el || retriedRef.current) {
      setFailed(true);
      return;
    }
    retriedRef.current = true;
    void (async () => {
      try {
        el.src = await fetchUrl();
        await el.play();
      } catch {
        setFailed(true);
      }
    })();
  }, [fetchUrl]);

  const total = durationSeconds ?? 0;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        aria-label={playing ? t.lex.pauseVoiceMessage : t.lex.playVoiceMessage}
        title={playing ? t.lex.pauseVoiceMessage : t.lex.playVoiceMessage}
        // 36px, so it is a real tap target inside the bubble on a phone.
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={total || 1}
        step={1}
        value={Math.min(position, total || 1)}
        // Seeking needs a known length. A recording whose duration never arrived still plays.
        disabled={!durationSeconds}
        onChange={(e) => {
          const next = Number(e.target.value);
          setPosition(next);
          if (audioRef.current) audioRef.current.currentTime = next;
        }}
        aria-label={t.lex.voiceMessage}
        // h-6 with a transparent box around a visually thin track: the thumb is what gets dragged,
        // and a 4px-tall control is the hardest thing on the screen to hit with a thumb.
        className="h-6 min-w-16 flex-1 cursor-pointer bg-transparent accent-current disabled:cursor-default"
      />

      <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-80">
        {failed
          ? t.lex.playbackFailed
          : `${formatDuration(position)} / ${formatDuration(total)}`}
      </span>

      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onError={handleError}
        className="hidden"
      />
    </div>
  );
}
