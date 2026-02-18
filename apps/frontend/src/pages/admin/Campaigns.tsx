import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  status: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = { name: "", subject: "", htmlBody: "" };

export default function Campaigns() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useLocalStorage<Campaign[]>("cf_campaigns", []);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const openCreate = () => {
    setEditingCampaign(null);
    setFormData(emptyForm);
    setIsDialogOpen(true);
  };

  const openEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setFormData({
      name: campaign.name,
      subject: campaign.subject,
      htmlBody: campaign.htmlBody,
    });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    const now = new Date().toISOString();
    if (editingCampaign) {
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === editingCampaign.id
            ? { ...c, ...formData, updatedAt: now }
            : c,
        ),
      );
    } else {
      const newCampaign: Campaign = {
        id: crypto.randomUUID(),
        ...formData,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      setCampaigns((prev) => [...prev, newCampaign]);
    }
    setIsDialogOpen(false);
    toast({ title: editingCampaign ? "Campaign updated" : "Campaign created" });
  };

  const handleDelete = (campaign: Campaign) => {
    setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
    toast({ title: "Campaign deleted" });
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t.campaigns.title}
        </h1>
        <Button onClick={openCreate} className="gradient-terracotta text-white hover:opacity-90">
          <Plus className="h-4 w-4 mr-2" />
          {t.campaigns.create}
        </Button>
      </div>

      <div className="card-elevated">
        {campaigns.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {t.campaigns.noCampaigns}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.campaigns.name}</TableHead>
                <TableHead>{t.campaigns.subject}</TableHead>
                <TableHead>{t.campaigns.status}</TableHead>
                <TableHead>{t.campaigns.sentAt}</TableHead>
                <TableHead className="text-right">{t.campaigns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">{campaign.name}</TableCell>
                  <TableCell>{campaign.subject}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {campaign.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {campaign.sentAt ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(campaign)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(campaign)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCampaign ? t.campaignForm.editTitle : t.campaignForm.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.campaignForm.name}</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.campaignForm.subject}</Label>
              <Input
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.campaignForm.htmlBody}</Label>
              <Textarea
                value={formData.htmlBody}
                onChange={(e) => setFormData({ ...formData, htmlBody: e.target.value })}
                rows={8}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t.campaignForm.cancel}
            </Button>
            <Button onClick={handleSave} className="gradient-terracotta text-white hover:opacity-90">
              {t.campaignForm.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
