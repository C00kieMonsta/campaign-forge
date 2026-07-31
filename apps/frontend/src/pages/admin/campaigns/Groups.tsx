import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@packages/ui";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { ContactGroup } from "@packages/types";

const COLORS = [
  { name: "red", bg: "bg-red-500" },
  { name: "blue", bg: "bg-blue-500" },
  { name: "green", bg: "bg-green-500" },
  { name: "amber", bg: "bg-amber-500" },
  { name: "purple", bg: "bg-purple-500" },
  { name: "pink", bg: "bg-pink-500" },
  { name: "teal", bg: "bg-teal-500" },
  { name: "orange", bg: "bg-orange-500" }
];

const emptyForm = { name: "", color: COLORS[0].name };

export default function Groups() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.groups.list();
      setGroups(data);
    } catch {
      toast({ title: "Failed to load groups", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const openCreate = () => {
    setEditingGroup(null);
    setFormData(emptyForm);
    setIsDialogOpen(true);
  };

  const openEdit = (group: ContactGroup) => {
    setEditingGroup(group);
    setFormData({ name: group.name, color: group.color });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      if (editingGroup) {
        await api.groups.update(editingGroup.id, { name: formData.name.trim(), color: formData.color });
        toast({ title: "Group updated" });
      } else {
        await api.groups.create({ name: formData.name.trim(), color: formData.color });
        toast({ title: "Group created" });
      }
      setIsDialogOpen(false);
      await loadGroups();
    } catch {
      toast({ title: "Failed to save group", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: ContactGroup) => {
    try {
      await api.groups.delete(group.id);
      toast({ title: "Group deleted" });
      setGroups((prev) => prev.filter((g) => g.id !== group.id));
    } catch {
      toast({ title: "Failed to delete group", variant: "destructive" });
    }
  };

  const colorBg = (name: string) =>
    COLORS.find((c) => c.name === name)?.bg ?? "bg-gray-500";

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t.groupsPage.title}
        </h1>
        <Button
          onClick={openCreate}
          className="gradient-terracotta text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t.groupsPage.addNew}
        </Button>
      </div>

      <div className="card-elevated">
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {t.groupsPage.noGroups}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.groupsPage.color}</TableHead>
                <TableHead>{t.groupsPage.name}</TableHead>
                <TableHead className="text-right">
                  {t.groupsPage.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <span
                      className={`inline-block w-4 h-4 rounded-full ${colorBg(group.color)}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(group)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(group)}
                      >
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
              {editingGroup ? t.groupsPage.editTitle : t.groupsPage.formTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.groupsPage.name}</Label>
              <Input
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t.groupsPage.color}</Label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setFormData({ ...formData, color: c.name })}
                    className={`w-8 h-8 rounded-full ${c.bg} flex items-center justify-center transition-transform hover:scale-110`}
                  >
                    {formData.color === c.name && (
                      <Check className="h-4 w-4 text-white" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t.groupsPage.cancel}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.groupsPage.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
