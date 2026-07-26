import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Campaign } from "@packages/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@packages/ui";
import { AlertTriangle, Loader2, MoreHorizontal, Plus, Send, TestTube, Trash2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { groupColorMap } from "@/lib/campaign-constants";

interface Contact {
  groups?: string[];
  status: string;
}

interface ContactGroup {
  id: string;
  name: string;
  color: string;
}

export default function Campaigns() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<ContactGroup[]>([]);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSent, setShowSent] = useState(false);

  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendingCampaign, setSendingCampaign] = useState<Campaign | null>(null);
  const [isSending, setIsSending] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingCampaign, setDeletingCampaign] = useState<Campaign | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCampaigns = useCallback(async () => {
    setIsLoading(true);
    try {
      const [{ items }, groupsData] = await Promise.all([
        api.campaigns.list(),
        api.groups.list(),
      ]);
      setCampaigns(items);
      setGroups(groupsData);

      const allContacts: Contact[] = [];
      let cursor: string | undefined;
      do {
        const res = await api.contacts.list({ status: "subscribed", limit: 200, cursor });
        allContacts.push(...(res.items as Contact[]));
        cursor = res.cursor ?? undefined;
      } while (cursor);
      setContacts(allContacts);
    } catch (err) {
      console.log(
        JSON.stringify({ event: "loadCampaigns:error", error: String(err) })
      );
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  // Poll while any campaign is in "sending" state
  useEffect(() => {
    const hasSending = campaigns.some((c) => c.status === "sending");

    if (hasSending && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const { items } = await api.campaigns.list();
          setCampaigns(items);
          if (!items.some((c) => c.status === "sending")) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            const justSent = items.find((c) => campaigns.find((prev) => prev.campaignId === c.campaignId && prev.status === "sending") && c.status === "sent");
            if (justSent) {
              toast({ title: `${t.campaignForm.sentSuccess} (${justSent.sentCount ?? 0})` });
            }
          }
        } catch {
          // ignore polling errors
        }
      }, 5000);
    }

    if (!hasSending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [campaigns, t, toast]);

  const getRecipientCount = (targetGroups?: string[]) => {
    if (!targetGroups || targetGroups.length === 0) return contacts.length;
    return contacts.filter((c) => c.groups?.some((g) => targetGroups.includes(g))).length;
  };

  const openDeleteCampaign = (campaign: Campaign) => {
    setDeletingCampaign(campaign);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingCampaign) return;
    setIsDeleting(true);
    try {
      await api.campaigns.delete(deletingCampaign.campaignId);
      setCampaigns((prev) =>
        prev.filter((c) => c.campaignId !== deletingCampaign.campaignId)
      );
      setDeleteDialogOpen(false);
      toast({ title: t.campaigns.deleted });
    } catch (err) {
      console.log(JSON.stringify({ event: "handleDelete:error", error: String(err) }));
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const openTestSend = (campaign: Campaign) => {
    setTestEmail("");
    setSendingCampaignId(campaign.campaignId);
    setTestDialogOpen(true);
  };

  const handleTestSend = async () => {
    if (!testEmail.trim() || !sendingCampaignId) return;
    setIsSending(true);
    try {
      await api.campaigns.testSendById(sendingCampaignId, testEmail.trim());
      setTestDialogOpen(false);
      toast({ title: t.campaignForm.testSentSuccess });
    } catch (err) {
      console.log(
        JSON.stringify({ event: "handleTestSend:error", error: String(err) })
      );
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const openSendCampaign = (campaign: Campaign) => {
    if (campaign.status === "sent" || campaign.status === "sending") {
      toast({ title: t.campaignForm.alreadySent, variant: "destructive" });
      return;
    }
    setSendingCampaign(campaign);
    setSendDialogOpen(true);
  };

  const handleSendCampaign = async () => {
    if (!sendingCampaign) return;
    setIsSending(true);
    try {
      await api.campaigns.send(sendingCampaign.campaignId);
      setCampaigns((prev) =>
        prev.map((c) =>
          c.campaignId === sendingCampaign.campaignId
            ? { ...c, status: "sending" as const, updatedAt: new Date().toISOString() }
            : c
        )
      );
      setSendDialogOpen(false);
      toast({ title: t.campaignForm.sendStarted });
    } catch (err) {
      console.log(JSON.stringify({ event: "handleSendCampaign:error", error: String(err) }));
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

  const sentCampaignsCount = campaigns.filter((c) => c.status === "sent").length;
  const visibleCampaigns = showSent
    ? campaigns
    : campaigns.filter((c) => c.status !== "sent");
  const sendingToAllContacts =
    !sendingCampaign?.targetGroups || sendingCampaign.targetGroups.length === 0;

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t.campaigns.title}
        </h1>
        <div className="flex items-center gap-4">
          {sentCampaignsCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <Checkbox
                checked={showSent}
                onCheckedChange={(checked) => setShowSent(checked === true)}
              />
              {t.campaigns.showSent} ({sentCampaignsCount})
            </label>
          )}
          <Button
            onClick={() => navigate("/campaigns/new")}
            className="gradient-terracotta text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t.campaigns.create}
          </Button>
        </div>
      </div>

      <div className="card-elevated">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {t.campaigns.noCampaigns}
          </div>
        ) : visibleCampaigns.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {t.campaigns.noVisibleCampaigns}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.campaigns.name}</TableHead>
                <TableHead>{t.campaigns.subject}</TableHead>
                <TableHead>{t.campaignForm.targetGroups}</TableHead>
                <TableHead>{t.campaigns.status}</TableHead>
                <TableHead className="text-right">
                  {t.campaigns.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCampaigns.map((campaign) => (
                <TableRow
                  key={campaign.campaignId}
                  onClick={() =>
                    navigate(`/campaigns/${campaign.campaignId}/edit`)
                  }
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">
                    <div className="max-w-[200px] truncate" title={campaign.name}>
                      {campaign.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div
                      className="max-w-[280px] truncate"
                      title={campaign.subject}
                    >
                      {campaign.subject}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const tg = campaign.targetGroups ?? [];
                      if (tg.length === 0)
                        return (
                          <span className="block max-w-[220px] truncate text-xs text-muted-foreground italic">
                            {t.campaignForm.allContacts}
                          </span>
                        );
                      return (
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {tg.map((gId) => {
                            const group = groups.find((g) => g.id === gId);
                            if (!group) return null;
                            const colorCls =
                              groupColorMap[group.color] ??
                              "bg-gray-100 text-gray-700 border-gray-200";
                            return (
                              <span
                                key={gId}
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorCls}`}
                              >
                                {group.name}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        campaign.status === "sent"
                          ? "bg-green-100 text-green-700 border-green-200"
                          : campaign.status === "sending"
                          ? "bg-blue-100 text-blue-700 border-blue-200"
                          : "bg-amber-100 text-amber-700 border-amber-200"
                      }`}
                    >
                      {campaign.status === "sending" && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {campaign.status === "sent"
                        ? `${t.campaigns.sent}${campaign.sentCount ? ` (${campaign.sentCount})` : ""}`
                        : campaign.status === "sending"
                        ? t.campaigns.sending
                        : t.campaigns.draft}
                    </span>
                    {campaign.sentAt && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {formatDate(campaign.sentAt)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right w-px whitespace-nowrap">
                    <div
                      className="flex justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t.campaigns.actions}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {campaign.status === "draft" && (
                            <>
                              <DropdownMenuItem
                                onClick={() => openTestSend(campaign)}
                              >
                                <TestTube className="h-4 w-4" />
                                {t.campaignForm.testSend}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openSendCampaign(campaign)}
                              >
                                <Send className="h-4 w-4" />
                                {t.campaignForm.confirmSend}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => openDeleteCampaign(campaign)}
                          >
                            <Trash2 className="h-4 w-4" />
                            {t.campaigns.delete}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Test Send Dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.campaignForm.testSend}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.campaignForm.testEmail}</Label>
              <Input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              {t.campaignForm.cancel}
            </Button>
            <Button
              onClick={handleTestSend}
              disabled={isSending}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t.campaignForm.testSendBtn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Campaign Confirmation Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={(open) => { if (!isSending) setSendDialogOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.campaignForm.sendConfirmTitle}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t.campaignForm.sendConfirmMessage}
            </p>
            <p className="text-sm font-medium">
              {getRecipientCount(sendingCampaign?.targetGroups)}{" "}
              {t.campaignForm.sendConfirmRecipients}
            </p>
            {sendingToAllContacts && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{t.campaignForm.sendConfirmAllWarning}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)} disabled={isSending}>
              {t.campaignForm.cancel}
            </Button>
            <Button
              onClick={handleSendCampaign}
              disabled={isSending}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              {t.campaignForm.confirmSend}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Campaign Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!isDeleting) setDeleteDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.campaigns.deleteConfirmTitle}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              {t.campaigns.deleteConfirmMessage}
            </p>
            {deletingCampaign && (
              <p className="text-sm font-medium">{deletingCampaign.name}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              {t.campaignForm.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {t.campaigns.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
