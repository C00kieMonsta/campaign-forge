import { useState } from "react";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface Contact {
  emailLower: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = { firstName: "", lastName: "", email: "" };

export default function Contacts() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [contacts, setContacts] = useLocalStorage<Contact[]>("cf_contacts", []);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const filtered = contacts.filter((c) => {
    const q = searchQuery.toLowerCase();
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
    return name.includes(q) || c.email.toLowerCase().includes(q);
  });

  const openCreate = () => {
    setEditingContact(null);
    setFormData(emptyForm);
    setIsDialogOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      firstName: contact.firstName ?? "",
      lastName: contact.lastName ?? "",
      email: contact.email,
    });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    const now = new Date().toISOString();
    if (editingContact) {
      setContacts((prev) =>
        prev.map((c) =>
          c.emailLower === editingContact.emailLower
            ? { ...c, ...formData, emailLower: formData.email.toLowerCase(), updatedAt: now }
            : c,
        ),
      );
    } else {
      const newContact: Contact = {
        emailLower: formData.email.toLowerCase(),
        email: formData.email,
        firstName: formData.firstName,
        lastName: formData.lastName,
        status: "active",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      };
      setContacts((prev) => [...prev, newContact]);
    }
    setIsDialogOpen(false);
    toast({ title: editingContact ? "Contact updated" : "Contact created" });
  };

  const handleDelete = (contact: Contact) => {
    setContacts((prev) => prev.filter((c) => c.emailLower !== contact.emailLower));
    toast({ title: "Contact deleted" });
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t.contacts.title}
        </h1>
        <Button onClick={openCreate} className="gradient-terracotta text-white hover:opacity-90">
          <Plus className="h-4 w-4 mr-2" />
          {t.contacts.addNew}
        </Button>
      </div>

      <div className="card-elevated">
        <div className="p-4 border-b border-border/50">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t.contacts.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {t.contacts.noContacts}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.contacts.name}</TableHead>
                <TableHead>{t.contacts.email}</TableHead>
                <TableHead>{t.contacts.status}</TableHead>
                <TableHead className="text-right">{t.contacts.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((contact) => (
                <TableRow key={contact.emailLower}>
                  <TableCell className="font-medium">
                    {contact.firstName} {contact.lastName}
                  </TableCell>
                  <TableCell>{contact.email}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {contact.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(contact)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(contact)}>
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
              {editingContact ? t.contactForm.editTitle : t.contactForm.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t.contactForm.firstName}</Label>
              <Input
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.contactForm.lastName}</Label>
              <Input
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.contactForm.email}</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t.contactForm.cancel}
            </Button>
            <Button onClick={handleSave} className="gradient-terracotta text-white hover:opacity-90">
              {t.contactForm.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
