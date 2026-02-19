import { useState } from "react";
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
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useToast } from "@/hooks/use-toast";

interface ContactGroup {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

interface Contact {
  emailLower: string;
  groups?: string[];
  [key: string]: unknown;
}

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
  const [groups, setGroups] = useLocalStorage<ContactGroup[]>("cf_groups", []);
  const [contacts, setContacts] = useLocalStorage<Contact[]>("cf_contacts", []);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const contactCountMap = contacts.reduce<Record<string, number>>((acc, c) => {
    c.groups?.forEach((gId) => {
      acc[gId] = (acc[gId] ?? 0) + 1;
    });
    return acc;
  }, {});

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

  const handleSave = () => {
    if (!formData.name.trim()) return;

    if (editingGroup) {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === editingGroup.id
            ? { ...g, name: formData.name.trim(), color: formData.color }
            : g
        )
      );
      toast({ title: "Group updated" });
    } else {
      const newGroup: ContactGroup = {
        id: crypto.randomUUID(),
        name: formData.name.trim(),
        color: formData.color,
        createdAt: new Date().toISOString()
      };
      setGroups((prev) => [...prev, newGroup]);
      toast({ title: "Group created" });
    }
    setIsDialogOpen(false);
  };

  const handleDelete = (group: ContactGroup) => {
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
    setContacts((prev) =>
      prev.map((c) =>
        c.groups?.includes(group.id)
          ? { ...c, groups: c.groups.filter((gId) => gId !== group.id) }
          : c
      )
    );
    toast({ title: "Group deleted" });
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
        {groups.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {t.groupsPage.noGroups}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.groupsPage.color}</TableHead>
                <TableHead>{t.groupsPage.name}</TableHead>
                <TableHead>{t.groupsPage.contactCount}</TableHead>
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
                  <TableCell>{contactCountMap[group.id] ?? 0}</TableCell>
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
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {t.groupsPage.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
