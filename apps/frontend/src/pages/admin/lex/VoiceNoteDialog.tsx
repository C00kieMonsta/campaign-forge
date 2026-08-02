import { useCallback, useEffect, useState } from "react";
import type { LexTranscript } from "@packages/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea
} from "@packages/ui";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { formatDuration } from "@/hooks/use-voice-recorder";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errorMessage";
import { useLexControllers } from "@/store/LexStoreProvider";

/**
 * A voice note, opened from the documents panel: re-listen to the audio (presigned URL),
 * re-read the transcript, correct it by hand (saving re-indexes the note from the corrected
 * text), or re-run speech-to-text from scratch.
 */
export default function VoiceNoteDialog({
  documentId,
  filename,
  onClose
}: {
  documentId: string;
  filename: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const controllers = useLexControllers();

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<LexTranscript | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retranscribing, setRetranscribing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ url }, loaded] = await Promise.all([
        api.lex.documents.viewUrl(documentId),
        controllers.documents.transcript(documentId)
      ]);
      setAudioUrl(url);
      setTranscript(loaded);
      setText(loaded.transcript ?? "");
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [documentId, controllers, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await controllers.documents.saveTranscript(
        documentId,
        text.trim()
      );
      setTranscript(saved);
      toast({ title: t.lex.transcriptSaved });
      onClose();
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRetranscribe = async () => {
    if (retranscribing) return;
    setRetranscribing(true);
    try {
      await controllers.documents.retranscribe(documentId);
      toast({ title: t.lex.retranscribeQueued });
      onClose();
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
    } finally {
      setRetranscribing(false);
    }
  };

  const pending =
    transcript !== null &&
    transcript.parseStatus !== "ready" &&
    transcript.parseStatus !== "failed";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate">{filename}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {audioUrl ? (
              <div className="space-y-1">
                {/* No <track>: the transcript shown below IS this audio's text alternative. */}
                <audio controls src={audioUrl} className="w-full" />
                {transcript?.durationSeconds ? (
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(transcript.durationSeconds)}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t.lex.transcript}</span>
                {pending ? (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t.lex.processing}
                  </span>
                ) : null}
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t.lex.noTranscript}
                rows={12}
              />
              <p className="text-xs text-muted-foreground">
                {t.lex.transcriptEditHint}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void handleRetranscribe()}
            disabled={loading || retranscribing || saving}
          >
            {retranscribing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {t.lex.retranscribe}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={
              loading ||
              saving ||
              retranscribing ||
              !text.trim() ||
              text.trim() === (transcript?.transcript ?? "").trim()
            }
            className="gradient-terracotta text-white hover:opacity-90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t.lex.saveTranscript}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
