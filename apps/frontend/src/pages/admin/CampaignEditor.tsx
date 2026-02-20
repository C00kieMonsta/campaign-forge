import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Input, Label } from "@packages/ui";
import { ArrowLeft, Eye, LayoutTemplate, Loader2, Save, Variable } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { ContactGroup } from "@packages/types";
import {
  EMAIL_TEMPLATES,
  SAMPLE_DATA,
  TEMPLATE_VARS,
  groupColorMap,
} from "@/lib/campaign-constants";
import TiptapEditor, { type TiptapEditorHandle } from "@/components/admin/TiptapEditor";

const emptyForm = {
  name: "",
  subject: "",
  html: "",
  targetGroups: [] as string[],
};

export default function CampaignEditor() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { toast } = useToast();
  const editorRef = useRef<TiptapEditorHandle>(null);

  const isEditing = Boolean(id);

  const [groups, setGroups] = useState<ContactGroup[]>([]);

  const [formData, setFormData] = useState(emptyForm);
  const [isSent, setIsSent] = useState(false);
  const [viewMode, setViewMode] = useState<"editor" | "preview">("editor");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [groupsData, campaignData] = await Promise.all([
        api.groups.list(),
        id ? api.campaigns.get(id) : null,
      ]);
      setGroups(groupsData);
      if (campaignData) {
        const { campaign } = campaignData;
        setIsSent(campaign.status === "sent");
        setFormData({
          name: campaign.name,
          subject: campaign.subject,
          html: campaign.html ?? "",
          targetGroups: campaign.targetGroups ?? [],
        });
      }
    } catch (err) {
      console.log(JSON.stringify({ event: "CampaignEditor:loadError", error: String(err) }));
      toast({ title: String(err), variant: "destructive" });
      if (id) navigate("/campaigns");
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const previewHtml = useMemo(() => {
    let html = formData.html;
    for (const [token, value] of Object.entries(SAMPLE_DATA)) {
      html = html.split(token).join(value);
    }
    return html;
  }, [formData.html]);

  const applyTemplate = (html: string) => {
    editorRef.current?.setContent(html);
  };

  const toggleGroup = (groupId: string) => {
    setFormData((prev) => ({
      ...prev,
      targetGroups: prev.targetGroups.includes(groupId)
        ? prev.targetGroups.filter((g) => g !== groupId)
        : [...prev.targetGroups, groupId],
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.subject.trim()) return;
    setIsSaving(true);
    try {
      if (isEditing && id) {
        await api.campaigns.update(id, {
          name: formData.name.trim(),
          subject: formData.subject.trim(),
          html: formData.html,
          targetGroups: formData.targetGroups,
        });
        toast({ title: "Campaign updated" });
      } else {
        await api.campaigns.create({
          name: formData.name.trim(),
          subject: formData.subject.trim(),
          html: formData.html,
          targetGroups: formData.targetGroups,
        });
        toast({ title: "Campaign created" });
      }
      navigate("/campaigns");
    } catch (err) {
      console.log(JSON.stringify({ event: "CampaignEditor:saveError", error: String(err) }));
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/campaigns")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-serif font-bold text-foreground">
            {isEditing ? t.campaignForm.editTitle : t.campaignForm.title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isSent && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
              {t.campaigns.sent}
            </span>
          )}
          <Button variant="outline" onClick={() => navigate("/campaigns")}>
            {t.campaignForm.cancel}
          </Button>
          {!isSent && (
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              {t.campaignForm.save}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {/* Name + Subject */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t.campaignForm.name}</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t.campaignForm.subject}</Label>
            <Input
              value={formData.subject}
              onChange={(e) => setFormData((prev) => ({ ...prev, subject: e.target.value }))}
            />
          </div>
        </div>

        {/* Target Groups */}
        <div className="space-y-2">
          <Label>{t.campaignForm.targetGroups}</Label>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t.campaignForm.noGroupsHint}</p>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              {groups.map((group) => {
                const selected = formData.targetGroups.includes(group.id);
                const colorCls = groupColorMap[group.color] ?? "bg-gray-100 text-gray-700 border-gray-200";
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
              {formData.targetGroups.length === 0 && (
                <span className="text-sm text-muted-foreground italic ml-1">
                  → {t.campaignForm.allContacts}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Editor / Preview — fills remaining space */}
        <div className="flex-1 flex flex-col min-h-0 card-elevated p-4">
          <div className="flex gap-1 border-b border-border mb-4">
            <button
              type="button"
              onClick={() => setViewMode("editor")}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                viewMode === "editor"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.campaignForm.editor}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                viewMode === "preview"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="h-4 w-4" />
              {t.campaignForm.preview}
            </button>
          </div>

          {viewMode === "editor" ? (
            <div className="flex-1 flex flex-col gap-3 min-h-0">
              {/* Template picker — hidden for sent campaigns */}
              {!isSent && (
                <div className="space-y-2">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <LayoutTemplate className="h-4 w-4" />
                    {t.campaignForm.templates}:
                  </span>
                  <div className="flex gap-2 flex-wrap">
                    {EMAIL_TEMPLATES.map((tpl) => {
                      const labelKey = `template${tpl.key.charAt(0).toUpperCase() + tpl.key.slice(1)}` as keyof typeof t.campaignForm;
                      const descKey = `template${tpl.key.charAt(0).toUpperCase() + tpl.key.slice(1)}Desc` as keyof typeof t.campaignForm;
                      return (
                        <button
                          key={tpl.key}
                          type="button"
                          onClick={() => applyTemplate(tpl.html)}
                          className="flex flex-col items-start px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-muted hover:border-primary/40 transition-all text-left"
                        >
                          <span className="text-xs font-medium text-foreground">{t.campaignForm[labelKey] as string}</span>
                          <span className="text-xs text-muted-foreground">{t.campaignForm[descKey] as string}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Variable insertion — hidden for sent campaigns */}
              {!isSent && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Variable className="h-4 w-4" />
                    {t.campaignForm.insertVariable}:
                  </span>
                  {TEMPLATE_VARS.map((v) => (
                    <Button
                      key={v.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => editorRef.current?.insertContent(v.token)}
                    >
                      {t.variables[v.key as keyof typeof t.variables]}
                    </Button>
                  ))}
                </div>
              )}

              {/* Tiptap editor — grows to fill remaining space */}
              <TiptapEditor
                ref={editorRef}
                content={formData.html}
                onChange={(html) => setFormData((prev) => ({ ...prev, html }))}
                readonly={isSent}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <iframe
                title="preview"
                sandbox=""
                srcDoc={previewHtml}
                className="flex-1 w-full border border-border rounded-lg"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
