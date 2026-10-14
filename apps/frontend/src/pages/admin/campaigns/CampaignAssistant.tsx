import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_ASSISTANT_UPLOAD_BYTES,
  type AssistantMessage,
  type CampaignDraft,
  type ContactGroup,
  type LexCitationEvent
} from "@packages/types";
import {
  Button,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea
} from "@packages/ui";
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  Image as ImageIcon,
  ImagePlus,
  ImageUp,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import VoiceCapture from "@/components/admin/VoiceCapture";
import { MarkdownMessage } from "@/components/lex/MarkdownMessage";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  clearCampaignAssistantSession,
  loadCampaignAssistantSession,
  saveCampaignAssistantSession,
  trimHistory
} from "@/lib/assistantSession";
import { groupColorMap, SAMPLE_DATA } from "@/lib/campaign-constants";
import {
  emptySlotCount,
  replaceSlotImage,
  slotStates
} from "@/lib/campaignDraft";
import { errorMessage } from "@/lib/errorMessage";
import { downscaleImage } from "@/lib/imageDownscale";

type MobileTab = "chat" | "draft";
type DraftTab = "preview" | "photos";
type ThinkingStage = 1 | 2 | 3;

interface FailedTurn {
  text: string;
  message: string;
}

// The assistant's replies carry no legal citations; the renderer still wants the list.
const NO_CITATIONS: LexCitationEvent[] = [];
const COMPOSER_MAX_HEIGHT = 160;
// When the waiting text moves on, in ms after the turn was sent.
const THINKING_STAGE_2_MS = 4000;
const THINKING_STAGE_3_MS = 25000;

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl border border-border bg-muted/40 px-4 py-2.5 text-sm md:max-w-[88%]">
        {children}
      </div>
    </div>
  );
}

export default function CampaignAssistant() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const ca = t.campaignAssistant;

  const [restored] = useState(loadCampaignAssistantSession);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>(
    restored?.messages ?? []
  );
  const [draft, setDraft] = useState<CampaignDraft | null>(
    restored?.draft ?? null
  );
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStage, setThinkingStage] = useState<ThinkingStage>(1);
  const [failed, setFailed] = useState<FailedTurn | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptHint, setTranscriptHint] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [draftUnseen, setDraftUnseen] = useState(false);
  const [draftTab, setDraftTab] = useState<DraftTab>("preview");

  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<string | null>(null);
  const mobileTabRef = useRef<MobileTab>(mobileTab);
  mobileTabRef.current = mobileTab;

  useEffect(() => {
    let cancelled = false;
    api.groups
      .list()
      .then((data) => {
        if (!cancelled) setGroups(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          toast({ title: errorMessage(err), variant: "destructive" });
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // A reload within the tab keeps the conversation; an empty one leaves nothing behind.
  useEffect(() => {
    if (messages.length === 0 && !draft) clearCampaignAssistantSession();
    else saveCampaignAssistantSession({ messages, draft });
  }, [messages, draft]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, isThinking, failed]);

  // The waiting text moves on so a long generation does not look stuck.
  useEffect(() => {
    if (!isThinking) return;
    setThinkingStage(1);
    const second = window.setTimeout(
      () => setThinkingStage(2),
      THINKING_STAGE_2_MS
    );
    const third = window.setTimeout(
      () => setThinkingStage(3),
      THINKING_STAGE_3_MS
    );
    return () => {
      window.clearTimeout(second);
      window.clearTimeout(third);
    };
  }, [isThinking]);

  // Grows with the text up to a few lines, then scrolls.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [input]);

  const busy = isThinking || isTranscribing;

  // A transcript lands in the composer for a read-through; the caret goes to its end.
  useEffect(() => {
    const el = composerRef.current;
    if (!transcriptHint || busy || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [transcriptHint, busy]);

  const draftHtml = draft?.html ?? "";
  const imageSlots = draft?.imageSlots;
  const slots = useMemo(
    () => (imageSlots ? slotStates(draftHtml, imageSlots) : []),
    [draftHtml, imageSlots]
  );
  const emptySlots = useMemo(
    () => (imageSlots ? emptySlotCount(draftHtml, imageSlots) : 0),
    [draftHtml, imageSlots]
  );
  const previewHtml = useMemo(() => {
    let html = draftHtml;
    for (const [token, value] of Object.entries(SAMPLE_DATA)) {
      html = html.split(token).join(value);
    }
    return html;
  }, [draftHtml]);

  const hasSession = messages.length > 0 || draft !== null || failed !== null;
  const canCreate =
    draft !== null &&
    draft.name.trim() !== "" &&
    draft.subject.trim() !== "" &&
    !isCreating;
  const suggestions = [ca.suggestion1, ca.suggestion2, ca.suggestion3];
  const thinkingText =
    thinkingStage === 1
      ? ca.thinking1
      : thinkingStage === 2
        ? ca.thinking2
        : ca.thinking3;

  const turnErrorTitle = (err: unknown): string => {
    const name = (err as { name?: unknown } | null)?.name;
    if (name === "AbortError" || name === "TimeoutError") return ca.timeout;
    if (err instanceof Error && err.message === "undecodable") {
      return t.contactAssistant.photoUnreadable;
    }
    const message =
      err instanceof Error || typeof err === "string" ? errorMessage(err) : "";
    if (/not configured/i.test(message)) return ca.notConfigured;
    return message || ca.error;
  };

  const sendTurn = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || isThinking) return;
      const userMessage: AssistantMessage = { role: "user", content };
      const history = trimHistory([...messages, userMessage]);
      setMessages((prev) => [...prev, userMessage]);
      // A retry leaves the composer alone unless it still holds the same text.
      setInput((prev) => (prev.trim() === content ? "" : prev));
      setTranscriptHint(false);
      setFailed(null);
      setIsThinking(true);
      try {
        const res = await api.campaigns.assistant.turn({
          messages: history,
          // The schema refuses a blank name or subject; a cleared field goes up as a stub.
          draft: draft
            ? {
                ...draft,
                name: draft.name.trim() || ca.draftTitle,
                subject: draft.subject.trim() || ca.draftTitle
              }
            : null,
          language
        });
        const reply = res.reply.trim();
        if (reply) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: reply }
          ]);
        }
        if (res.draft) {
          setDraft(res.draft);
          if (mobileTabRef.current === "chat") setDraftUnseen(true);
        }
      } catch (err) {
        // The turn never happened: give the text back so it can be resent.
        const title = turnErrorTitle(err);
        setMessages((prev) => prev.filter((m) => m !== userMessage));
        setInput(content);
        setFailed({ text: content, message: title });
        toast({ title, variant: "destructive" });
      } finally {
        setIsThinking(false);
      }
    },
    [draft, isThinking, language, messages, toast, ca]
  );

  const handleRecorded = async (file: File) => {
    setIsTranscribing(true);
    try {
      const { text } = await api.campaigns.assistant.transcribe(file);
      const transcript = text.trim();
      if (!transcript) {
        toast({ title: t.voiceCapture.empty, variant: "destructive" });
        return;
      }
      setInput(transcript.slice(0, MAX_ASSISTANT_MESSAGE_CHARS));
      setTranscriptHint(true);
    } catch (err) {
      toast({ title: turnErrorTitle(err), variant: "destructive" });
    } finally {
      setIsTranscribing(false);
    }
  };

  const startOver = () => {
    if (!window.confirm(ca.startOverConfirm)) return;
    setMessages([]);
    setDraft(null);
    setInput("");
    setFailed(null);
    setTranscriptHint(false);
    setDraftUnseen(false);
    setDraftTab("preview");
    clearCampaignAssistantSession();
  };

  const updateDraft = (patch: Partial<CampaignDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleGroup = (groupId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const ids = prev.targetGroupIds.includes(groupId)
        ? prev.targetGroupIds.filter((g) => g !== groupId)
        : [...prev.targetGroupIds, groupId];
      return { ...prev, targetGroupIds: ids };
    });
  };

  const pickPhoto = (slotId: string) => {
    pendingSlotRef.current = slotId;
    photoInputRef.current?.click();
  };

  const uploadPhoto = async (slotId: string, file: File) => {
    setUploadingSlot(slotId);
    try {
      const photo = await downscaleImage(file);
      if (photo.size > MAX_ASSISTANT_UPLOAD_BYTES) {
        toast({
          title: t.contactAssistant.photoTooLarge,
          variant: "destructive"
        });
        return;
      }
      const { url } = await api.campaigns.upload(photo);
      setDraft((prev) =>
        prev
          ? { ...prev, html: replaceSlotImage(prev.html, slotId, url) }
          : prev
      );
      toast({ title: ca.photoAdded });
    } catch (err) {
      toast({ title: turnErrorTitle(err), variant: "destructive" });
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleCreate = async () => {
    if (!draft || !canCreate) return;
    setIsCreating(true);
    try {
      const { campaign } = await api.campaigns.create({
        name: draft.name.trim(),
        subject: draft.subject.trim(),
        html: draft.html,
        targetGroups: draft.targetGroupIds
      });
      clearCampaignAssistantSession();
      toast({ title: ca.created });
      navigate(`/campaigns/mailings/${campaign.campaignId}/edit`);
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
      setIsCreating(false);
    }
  };

  const segmentClass = (active: boolean) =>
    `inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="animate-fade-up h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => navigate("/campaigns/mailings")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-serif font-bold text-foreground">
              {ca.title}
            </h1>
            <p className="hidden sm:block text-sm text-muted-foreground mt-1">
              {ca.subtitle}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={startOver}
          disabled={!hasSession || busy || isCreating}
          className="shrink-0"
        >
          <RotateCcw className="h-4 w-4" />
          <span className="hidden sm:inline">{ca.startOver}</span>
        </Button>
      </div>

      {/* Below lg: one pane at a time */}
      <div className="lg:hidden grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 mb-3">
        <button
          type="button"
          onClick={() => setMobileTab("chat")}
          className={segmentClass(mobileTab === "chat")}
        >
          <MessageSquare className="h-4 w-4" />
          {ca.chatTab}
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileTab("draft");
            setDraftUnseen(false);
          }}
          className={segmentClass(mobileTab === "draft")}
        >
          <Sparkles className="h-4 w-4" />
          {ca.draftTab}
          {draftUnseen && mobileTab === "chat" && (
            <span
              className="h-2 w-2 rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Chat */}
        <section
          className={`${
            mobileTab === "chat" ? "flex" : "hidden"
          } lg:flex lg:col-span-5 flex-col min-h-0 card-elevated overflow-hidden`}
        >
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3"
          >
            {messages.length === 0 && (
              <>
                <AssistantBubble>
                  <p className="leading-relaxed">{ca.welcome}</p>
                </AssistantBubble>
                <div className="flex flex-wrap gap-2 pl-1">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={busy}
                      onClick={() => void sendTurn(suggestion)}
                      className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={index} className="flex justify-end">
                  <div className="max-w-[90%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground whitespace-pre-wrap break-words md:max-w-[85%]">
                    {message.content}
                  </div>
                </div>
              ) : (
                <AssistantBubble key={index}>
                  <MarkdownMessage
                    content={message.content}
                    citations={NO_CITATIONS}
                  />
                </AssistantBubble>
              )
            )}
            {isThinking && (
              <AssistantBubble>
                <span
                  className="inline-flex items-center gap-2 text-muted-foreground"
                  aria-live="polite"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {thinkingText}
                </span>
              </AssistantBubble>
            )}
            {failed && !isThinking && (
              <AssistantBubble>
                <div className="space-y-2">
                  <p className="text-destructive">{failed.message}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void sendTurn(failed.text)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {ca.retry}
                  </Button>
                </div>
              </AssistantBubble>
            )}
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-wrap items-end gap-2">
              <Textarea
                ref={composerRef}
                value={input}
                rows={1}
                enterKeyHint="send"
                maxLength={MAX_ASSISTANT_MESSAGE_CHARS}
                onChange={(e) => {
                  setInput(e.target.value);
                  setTranscriptHint(false);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendTurn(input);
                  }
                }}
                placeholder={ca.composerPlaceholder}
                disabled={busy}
                className="min-h-10 max-h-40 grow basis-40 min-w-0 resize-none overflow-y-auto"
              />
              <VoiceCapture
                variant="icon"
                onRecorded={(file) => void handleRecorded(file)}
                disabled={isThinking}
                busy={isTranscribing}
                className="shrink-0 max-w-full"
              />
              <Button
                size="icon"
                onClick={() => void sendTurn(input)}
                disabled={busy || !input.trim()}
                title={ca.send}
                aria-label={ca.send}
                className="shrink-0 gradient-terracotta text-white hover:opacity-90"
              >
                {isThinking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            {transcriptHint && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {ca.transcriptInComposer}
              </p>
            )}
          </div>
        </section>

        {/* Draft */}
        <section
          className={`${
            mobileTab === "draft" ? "flex" : "hidden"
          } lg:flex lg:col-span-7 flex-col min-h-0 card-elevated overflow-y-auto lg:overflow-hidden`}
        >
          {!draft ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
              <Sparkles className="h-10 w-10 opacity-40" />
              <p className="text-sm max-w-xs">{ca.noDraftYet}</p>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-border p-4 space-y-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  {ca.draftTitle}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="assistant-name">{ca.name}</Label>
                    <Input
                      id="assistant-name"
                      value={draft.name}
                      onChange={(e) => updateDraft({ name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="assistant-subject">{ca.subject}</Label>
                    <Input
                      id="assistant-subject"
                      value={draft.subject}
                      onChange={(e) => updateDraft({ subject: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{ca.targets}</Label>
                  {groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      {t.campaignForm.noGroupsHint}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 items-center">
                      {groups.map((group) => {
                        const selected = draft.targetGroupIds.includes(
                          group.id
                        );
                        const colorCls =
                          groupColorMap[group.color] ??
                          "bg-gray-100 text-gray-700 border-gray-200";
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => toggleGroup(group.id)}
                            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                              selected
                                ? `${colorCls} ring-2 ring-offset-1 ring-primary/30`
                                : "bg-muted text-muted-foreground border-transparent opacity-50 hover:opacity-75"
                            }`}
                          >
                            {group.name}
                          </button>
                        );
                      })}
                      {draft.targetGroupIds.length === 0 && (
                        <span className="text-sm text-muted-foreground italic ml-1">
                          → {ca.allContacts}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Tabs
                value={draftTab}
                onValueChange={(value) => setDraftTab(value as DraftTab)}
                className="gap-0 lg:flex-1 lg:min-h-0"
              >
                <div className="shrink-0 px-4 pt-3">
                  <TabsList>
                    <TabsTrigger value="preview">
                      <Eye className="h-4 w-4" />
                      {ca.preview}
                    </TabsTrigger>
                    <TabsTrigger value="photos">
                      <ImagePlus className="h-4 w-4" />
                      {ca.photos}
                      {slots.length > 0 && (
                        <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular-nums">
                          {slots.length - emptySlots}/{slots.length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent
                  value="preview"
                  className="flex flex-col p-4 lg:min-h-0"
                >
                  <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border bg-white">
                    <iframe
                      title="preview"
                      sandbox=""
                      srcDoc={previewHtml}
                      className="block w-full h-[60vh] lg:h-full min-h-[420px]"
                    />
                  </div>
                </TabsContent>
                <TabsContent
                  value="photos"
                  className="p-4 space-y-3 lg:min-h-0 lg:overflow-y-auto"
                >
                  {slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      {ca.noPhotos}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {ca.photosHint}
                      </p>
                      <ul className="space-y-2">
                        {slots.map((slot) => (
                          <li
                            key={slot.id}
                            className="flex items-center gap-3 rounded-lg border border-border p-3"
                          >
                            <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                              {slot.filled && slot.src ? (
                                <img
                                  src={slot.src}
                                  alt={slot.label}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">
                                {slot.label}
                              </p>
                              {slot.description && (
                                <p className="text-xs text-muted-foreground">
                                  {slot.description}
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={uploadingSlot !== null}
                              onClick={() => pickPhoto(slot.id)}
                              className="shrink-0"
                            >
                              {uploadingSlot === slot.id ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {ca.uploading}
                                </>
                              ) : slot.filled ? (
                                <>
                                  <ImageUp className="h-3.5 w-3.5" />
                                  {ca.replacePhoto}
                                </>
                              ) : (
                                <>
                                  <ImagePlus className="h-3.5 w-3.5" />
                                  {ca.addPhoto}
                                </>
                              )}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </TabsContent>
              </Tabs>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  const slotId = pendingSlotRef.current;
                  e.target.value = "";
                  pendingSlotRef.current = null;
                  if (file && slotId) void uploadPhoto(slotId, file);
                }}
              />

              {/* Footer */}
              <div className="shrink-0 border-t border-border p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                {emptySlots > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-1">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {emptySlots} {ca.photosLeft}
                      </p>
                      <p className="text-xs mt-0.5">{ca.photosLeftWarning}</p>
                    </div>
                  </div>
                )}
                <Button
                  onClick={() => void handleCreate()}
                  disabled={!canCreate}
                  className="gradient-terracotta text-white hover:opacity-90 sm:ml-auto"
                >
                  {isCreating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {isCreating ? ca.creating : ca.createCampaign}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
