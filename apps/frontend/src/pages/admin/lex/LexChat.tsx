import { memo, useCallback, useEffect, useRef, useState } from "react";
import type {
  LexCitationEvent,
  LexConversation,
  LexMessage
} from "@packages/types";
import { Button, Input } from "@packages/ui";
import { ArrowLeft, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { streamLexMessage } from "@/lib/lexStream";

// Reuse the shared message type rather than redeclaring its shape.
type ChatMsg = Pick<LexMessage, "id" | "role" | "content">;

const SourceChips = memo(function SourceChips({
  citations
}: {
  citations: LexCitationEvent[];
}) {
  const { t } = useLanguage();
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <span className="text-xs text-muted-foreground mr-1">
        {t.lex.sources}:
      </span>
      {citations.map((c) => (
        <span
          key={`${c.chunkId}-${c.index ?? 0}`}
          title={c.quote ?? ""}
          className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground/80"
        >
          [{c.index ?? "?"}] {c.filename ?? "source"}
          {c.pageFrom ? `, p.${c.pageFrom}` : ""}
        </span>
      ))}
    </div>
  );
});

export default function LexChat() {
  const { id: workspaceId = "" } = useParams();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<LexConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [citationsByMessage, setCitationsByMessage] = useState<
    Record<string, LexCitationEvent[]>
  >({});
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamCitations, setStreamCitations] = useState<LexCitationEvent[]>(
    []
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const { items } = await api.lex.conversations.list(workspaceId);
    setConversations(items);
    return items;
  }, [workspaceId]);

  const selectConversation = useCallback(
    async (convId: string) => {
      setActiveId(convId);
      setCitationsByMessage({});
      try {
        const { items } = await api.lex.conversations.messages(convId);
        setMessages(
          items.map((m) => ({ id: m.id, role: m.role, content: m.content }))
        );
      } catch (err) {
        toast({ title: String(err), variant: "destructive" });
      }
    },
    [toast]
  );

  useEffect(() => {
    loadConversations()
      .then((items) => {
        if (items.length > 0) void selectConversation(items[0].id);
      })
      .catch((err) => toast({ title: String(err), variant: "destructive" }));
  }, [loadConversations, selectConversation, toast]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText]);

  const handleNewConversation = () => {
    setActiveId(null);
    setMessages([]);
    setCitationsByMessage({});
  };

  const handleDeleteConversation = async (convId: string) => {
    if (!window.confirm(t.lex.confirmDelete)) return;
    try {
      await api.lex.conversations.delete(convId);
      const remaining = conversations.filter((c) => c.id !== convId);
      setConversations(remaining);
      if (activeId === convId) handleNewConversation();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    // Ensure a conversation exists.
    let convId = activeId;
    if (!convId) {
      try {
        const { conversation } = await api.lex.conversations.create(
          workspaceId,
          {
            title: text.slice(0, 60)
          }
        );
        convId = conversation.id;
        setActiveId(convId);
        setConversations((prev) => [conversation, ...prev]);
      } catch (err) {
        toast({ title: String(err), variant: "destructive" });
        return;
      }
    }

    const userMsg: ChatMsg = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamText("");
    setStreamCitations([]);

    let accumulated = "";
    let finalCitations: LexCitationEvent[] = [];
    try {
      await streamLexMessage(convId, text, {
        onToken: (delta) => {
          accumulated += delta;
          setStreamText(accumulated);
        },
        onCitations: (citations) => {
          finalCitations = citations;
          setStreamCitations(citations);
        },
        onDone: (messageId) => {
          setMessages((prev) => [
            ...prev,
            { id: messageId, role: "assistant", content: accumulated }
          ]);
          setCitationsByMessage((prev) => ({
            ...prev,
            [messageId]: finalCitations
          }));
        },
        onError: (message) => toast({ title: message, variant: "destructive" })
      });
      void loadConversations();
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setStreaming(false);
      setStreamText("");
      setStreamCitations([]);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4">
      {/* Conversation list */}
      <aside className="w-64 shrink-0 flex flex-col border-r pr-3">
        <button
          onClick={() => navigate(`/lex/workspaces/${workspaceId}`)}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.lex.back}
        </button>
        <Button
          variant="outline"
          size="sm"
          className="mb-3"
          onClick={handleNewConversation}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t.lex.newConversation}
        </Button>
        <div className="flex-1 overflow-auto space-y-1">
          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2">
              {t.lex.noConversations}
            </p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-sm cursor-pointer ${
                  activeId === c.id ? "bg-muted" : "hover:bg-muted/50"
                }`}
                onClick={() => void selectConversation(c.id)}
              >
                <span className="truncate">{c.title || t.lex.untitled}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteConversation(c.id);
                  }}
                  aria-label={t.lex.deleteConversation}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-auto space-y-4 pr-2">
          {messages.length === 0 && !streaming ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              {t.lex.askPlaceholder}
            </div>
          ) : null}

          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "bg-card border"
                }`}
              >
                {m.content}
                {m.role === "assistant" ? (
                  <SourceChips citations={citationsByMessage[m.id] ?? []} />
                ) : null}
              </div>
            </div>
          ))}

          {streaming ? (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap bg-card border">
                {streamText || (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t.lex.thinking}
                  </span>
                )}
                <SourceChips citations={streamCitations} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t.lex.askPlaceholder}
            disabled={streaming}
          />
          <Button
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim()}
            className="gradient-terracotta text-white shrink-0"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
