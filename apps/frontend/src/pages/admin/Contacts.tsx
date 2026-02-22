import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@packages/ui";
import { ChevronDown, Copy, Download, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { Contact, ContactGroup, ContactFormData, ContactFormErrors, ImportPreview } from "./contacts/types";
import { emptyForm, AUTO_COLORS, CSV_COLUMNS, downloadTemplate, getGroupClasses, parseCsv } from "./contacts/constants";
import { ContactFormDialog } from "./contacts/ContactFormDialog";
import { ImportPreviewDialog } from "./contacts/ImportPreviewDialog";
import { ContactsTable } from "./contacts/ContactsTable";

export default function Contacts() {
  const { t } = useLanguage();
  const { toast } = useToast();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ContactGroup[]>([]);

  // Filters + pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "subscribed" | "unsubscribed">("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchGroupOpen, setBatchGroupOpen] = useState(false);
  const batchGroupRef = useRef<HTMLDivElement>(null);

  // Contact form dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState<ContactFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<ContactFormErrors>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ basic: true });

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);

  // Duplicate confirmation
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const [contactToDuplicate, setContactToDuplicate] = useState<Contact | null>(null);

  // CSV import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadContacts = useCallback(async () => {
    try {
      setLoading(true);
      const [allContacts, groupsData] = await Promise.all([
        (async () => {
          const items: Contact[] = [];
          let cursor: string | undefined;
          do {
            const res = await api.contacts.list({ limit: 200, cursor });
            items.push(...(res.items as Contact[]));
            cursor = res.cursor ?? undefined;
          } while (cursor);
          return items;
        })(),
        api.groups.list(),
      ]);
      setContacts(allContacts);
      setGroups(groupsData);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // Close batch group popover on outside click
  useEffect(() => {
    if (!batchGroupOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (batchGroupRef.current && !batchGroupRef.current.contains(e.target as Node)) {
        setBatchGroupOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [batchGroupOpen]);

  // ─── Filtering ─────────────────────────────────────────────────────────────

  const filtered = contacts
    .filter((c) => {
      const q = searchQuery.toLowerCase();
      const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
      const matchesSearch = !q || name.includes(q) || c.email.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const matchesGroup = groupFilter === "all" || (c.groups ?? []).includes(groupFilter);
      return matchesSearch && matchesStatus && matchesGroup;
    })
    .sort((a, b) => {
      const nameA = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim().toLowerCase();
      const nameB = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, "fr");
    });

  // ─── Batch selection ───────────────────────────────────────────────────────

  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const allPageSelected = paginated.length > 0 && paginated.every((c) => selectedIds.has(c.emailLower));
  const somePageSelected = paginated.some((c) => selectedIds.has(c.emailLower));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) { paginated.forEach((c) => next.delete(c.emailLower)); }
      else { paginated.forEach((c) => next.add(c.emailLower)); }
      return next;
    });
  };

  const toggleSelect = (emailLower: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(emailLower) ? next.delete(emailLower) : next.add(emailLower);
      return next;
    });
  };

  // ─── Batch operations ──────────────────────────────────────────────────────

  const handleBatchAddGroup = async (groupId: string) => {
    const count = selectedIds.size;
    try {
      await Promise.all(
        [...selectedIds].map((emailLower) => {
          const contact = contacts.find((c) => c.emailLower === emailLower);
          const groupsArr = [...new Set([...(contact?.groups ?? []), groupId])];
          return api.contacts.update(emailLower, { groups: groupsArr });
        })
      );
      setContacts((prev) =>
        prev.map((c) => selectedIds.has(c.emailLower) ? { ...c, groups: [...new Set([...(c.groups ?? []), groupId])] } : c)
      );
      setSelectedIds(new Set());
      setBatchGroupOpen(false);
      toast({ title: `${t.contacts.batchGroupAdded} ${count} ${t.contacts.batchContacts}` });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const confirmBatchDelete = async () => {
    const count = selectedIds.size;
    try {
      await Promise.all([...selectedIds].map((emailLower) => api.contacts.delete(emailLower)));
      setContacts((prev) => prev.filter((c) => !selectedIds.has(c.emailLower)));
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      setContactToDelete(null);
      toast({ title: `${count} ${t.contacts.batchDeleted}` });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  // ─── Contact CRUD ──────────────────────────────────────────────────────────

  const toggleContactGroup = async (contact: Contact, groupId: string) => {
    const curr = contact.groups ?? [];
    const next = curr.includes(groupId) ? curr.filter((id) => id !== groupId) : [...curr, groupId];
    const groupsArr = next.length > 0 ? next : undefined;
    try {
      await api.contacts.update(contact.emailLower, { groups: groupsArr });
      setContacts((prev) => prev.map((c) => (c.emailLower === contact.emailLower ? { ...c, groups: groupsArr } : c)));
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const handleDelete = (contact: Contact) => {
    setContactToDelete(contact);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!contactToDelete) return;
    try {
      await api.contacts.delete(contactToDelete.emailLower);
      setContacts((prev) => prev.filter((c) => c.emailLower !== contactToDelete.emailLower));
      setDeleteConfirmOpen(false);
      setContactToDelete(null);
      toast({ title: "Contact deleted" });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  // ─── Form management ───────────────────────────────────────────────────────

  const updateField = (field: keyof ContactFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === "firstName" || field === "lastName" || field === "email") {
      setFormErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const toggleGroup = (groupId: string) =>
    setFormData((prev) => ({
      ...prev,
      groups: prev.groups.includes(groupId) ? prev.groups.filter((id) => id !== groupId) : [...prev.groups, groupId],
    }));

  const openCreate = () => {
    setEditingContact(null);
    setFormData(emptyForm);
    setFormErrors({});
    setOpenSections({ basic: true });
    setIsDialogOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      firstName: contact.firstName ?? "", lastName: contact.lastName ?? "", email: contact.email,
      displayName: contact.displayName ?? "", email2: contact.email2 ?? "",
      homePhone: contact.homePhone ?? "", businessPhone: contact.businessPhone ?? "", mobilePhone: contact.mobilePhone ?? "",
      homeStreet: contact.homeStreet ?? "", homeAddress2: contact.homeAddress2 ?? "", homeCity: contact.homeCity ?? "",
      homePostalCode: contact.homePostalCode ?? "", homeCountry: contact.homeCountry ?? "",
      businessAddress: contact.businessAddress ?? "", businessAddress2: contact.businessAddress2 ?? "",
      businessCity: contact.businessCity ?? "", businessState: contact.businessState ?? "",
      businessPostalCode: contact.businessPostalCode ?? "", businessCountry: contact.businessCountry ?? "",
      organization: contact.organization ?? "", notes: contact.notes ?? "", birthday: contact.birthday ?? "",
      groups: contact.groups ?? [],
    });
    setFormErrors({});
    setOpenSections({ basic: true });
    setIsDialogOpen(true);
  };

  const openDuplicate = (contact: Contact) => {
    setContactToDuplicate(contact);
    setDuplicateConfirmOpen(true);
  };

  const confirmDuplicate = () => {
    if (!contactToDuplicate) return;
    setEditingContact(null);
    setFormData({
      firstName: contactToDuplicate.firstName ?? "", lastName: contactToDuplicate.lastName ?? "", email: "",
      displayName: contactToDuplicate.displayName ?? "", email2: contactToDuplicate.email2 ?? "",
      homePhone: contactToDuplicate.homePhone ?? "", businessPhone: contactToDuplicate.businessPhone ?? "", mobilePhone: contactToDuplicate.mobilePhone ?? "",
      homeStreet: contactToDuplicate.homeStreet ?? "", homeAddress2: contactToDuplicate.homeAddress2 ?? "", homeCity: contactToDuplicate.homeCity ?? "",
      homePostalCode: contactToDuplicate.homePostalCode ?? "", homeCountry: contactToDuplicate.homeCountry ?? "",
      businessAddress: contactToDuplicate.businessAddress ?? "", businessAddress2: contactToDuplicate.businessAddress2 ?? "",
      businessCity: contactToDuplicate.businessCity ?? "", businessState: contactToDuplicate.businessState ?? "",
      businessPostalCode: contactToDuplicate.businessPostalCode ?? "", businessCountry: contactToDuplicate.businessCountry ?? "",
      organization: contactToDuplicate.organization ?? "", notes: contactToDuplicate.notes ?? "", birthday: contactToDuplicate.birthday ?? "",
      groups: contactToDuplicate.groups ?? [],
    });
    setFormErrors({});
    setOpenSections({ basic: true });
    setDuplicateConfirmOpen(false);
    setContactToDuplicate(null);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const errors: ContactFormErrors = {};
    if (!formData.firstName.trim()) errors.firstName = "Le prénom est requis";
    if (!formData.lastName.trim()) errors.lastName = "Le nom est requis";
    if (!formData.email.trim()) errors.email = "L'email est requis";
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setOpenSections((prev) => ({ ...prev, basic: true }));
      return;
    }

    if (!editingContact) {
      const emailLower = formData.email.trim().toLowerCase();
      const existing = contacts.find((c) => c.emailLower === emailLower);
      if (existing) {
        setFormErrors({ email: `Ce contact existe déjà (${existing.firstName ?? ""} ${existing.lastName ?? ""})`.trim() });
        setOpenSections((prev) => ({ ...prev, basic: true }));
        return;
      }
    }

    const fields = {
      firstName: formData.firstName || undefined, lastName: formData.lastName || undefined,
      displayName: formData.displayName || undefined, email2: formData.email2 || undefined,
      homePhone: formData.homePhone || undefined, businessPhone: formData.businessPhone || undefined, mobilePhone: formData.mobilePhone || undefined,
      homeStreet: formData.homeStreet || undefined, homeAddress2: formData.homeAddress2 || undefined, homeCity: formData.homeCity || undefined,
      homePostalCode: formData.homePostalCode || undefined, homeCountry: formData.homeCountry || undefined,
      businessAddress: formData.businessAddress || undefined, businessAddress2: formData.businessAddress2 || undefined,
      businessCity: formData.businessCity || undefined, businessState: formData.businessState || undefined,
      businessPostalCode: formData.businessPostalCode || undefined, businessCountry: formData.businessCountry || undefined,
      organization: formData.organization || undefined, notes: formData.notes || undefined, birthday: formData.birthday || undefined,
      groups: formData.groups.length > 0 ? formData.groups : undefined,
    };

    try {
      if (editingContact) {
        const { contact } = await api.contacts.update(editingContact.emailLower, fields);
        setContacts((prev) => prev.map((c) => (c.emailLower === editingContact.emailLower ? contact : c)));
      } else {
        const { contact } = await api.contacts.create({ email: formData.email, ...fields });
        setContacts((prev) => [...prev, contact]);
      }
      setIsDialogOpen(false);
      toast({ title: editingContact ? "Contact updated" : "Contact created" });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  // ─── CSV import ────────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) { toast({ title: "Empty CSV file", variant: "destructive" }); return; }

      const headerMap = new Map<string, string>();
      for (const col of CSV_COLUMNS) headerMap.set(col.header.toLowerCase(), col.field);

      const existingEmails = new Set(contacts.map((c) => c.emailLower));
      const existingGroupNames = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));
      let skipped = 0, duplicates = 0;
      const newGroupNamesSet = new Set<string>();
      const toImport: ImportPreview["toImport"] = [];

      for (const row of rows) {
        const mapped: Record<string, string> = {};
        let groupRaw = "";
        for (const [csvHeader, value] of Object.entries(row)) {
          const field = headerMap.get(csvHeader.toLowerCase().trim());
          if (field === "group") { groupRaw = value; }
          else if (field) { mapped[field] = value; }
        }

        const email = mapped.email?.trim();
        if (!email || !email.includes("@")) { skipped++; continue; }
        if (existingEmails.has(email.toLowerCase())) { duplicates++; continue; }
        existingEmails.add(email.toLowerCase());

        const groupNames = groupRaw.split(";").map((g) => g.trim()).filter(Boolean);
        for (const gn of groupNames) {
          if (!existingGroupNames.has(gn.toLowerCase())) {
            newGroupNamesSet.add(gn);
            existingGroupNames.set(gn.toLowerCase(), "__pending__");
          }
        }

        toImport.push({
          contact: {
            email, emailLower: email.toLowerCase(),
            firstName: mapped.firstName || undefined, lastName: mapped.lastName || undefined,
            displayName: mapped.displayName || undefined, email2: mapped.email2 || undefined,
            homePhone: mapped.homePhone || undefined, businessPhone: mapped.businessPhone || undefined, mobilePhone: mapped.mobilePhone || undefined,
            homeStreet: mapped.homeStreet || undefined, homeAddress2: mapped.homeAddress2 || undefined, homeCity: mapped.homeCity || undefined,
            homePostalCode: mapped.homePostalCode || undefined, homeCountry: mapped.homeCountry || undefined,
            businessAddress: mapped.businessAddress || undefined, businessAddress2: mapped.businessAddress2 || undefined,
            businessCity: mapped.businessCity || undefined, businessState: mapped.businessState || undefined,
            businessPostalCode: mapped.businessPostalCode || undefined, businessCountry: mapped.businessCountry || undefined,
            organization: mapped.organization || undefined, notes: mapped.notes || undefined, birthday: mapped.birthday || undefined,
          },
          groupNames,
        });
      }

      setImportPreview({ toImport, skipped, duplicates, newGroupNames: [...newGroupNamesSet] });
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    try {
      const groupNameToId = new Map<string, string>(groups.map((g) => [g.name.toLowerCase(), g.id]));
      for (let i = 0; i < importPreview.newGroupNames.length; i++) {
        const created = await api.groups.create({ name: importPreview.newGroupNames[i], color: AUTO_COLORS[i % AUTO_COLORS.length] });
        groupNameToId.set(importPreview.newGroupNames[i].toLowerCase(), created.id);
      }

      const toCreate = importPreview.toImport.map(({ contact, groupNames }) => {
        const groupIds = groupNames.map((name) => groupNameToId.get(name.toLowerCase())).filter(Boolean) as string[];
        return { ...contact, ...(groupIds.length > 0 ? { groups: groupIds } : {}) };
      });

      const BATCH_SIZE = 100;
      let totalImported = 0;
      for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
        const result = await api.contacts.importContacts(toCreate.slice(i, i + BATCH_SIZE) as import("@packages/types").Contact[]);
        totalImported += result.imported;
      }
      setImportPreview(null);
      await loadContacts();
      toast({ title: `${totalImported} ${t.contacts.importSuccess}` });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">{t.contacts.title}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" />{t.contacts.downloadTemplate}
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />{t.contacts.importCsv}
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
          <Button onClick={openCreate} className="gradient-terracotta text-white hover:opacity-90">
            <Plus className="h-4 w-4 mr-2" />{t.contacts.addNew}
          </Button>
        </div>
      </div>

      <div className="card-elevated">
        {/* Filters bar */}
        <div className="p-4 border-b border-border/50 flex flex-wrap gap-3 items-center">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t.contacts.search}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t.contacts.filterAllStatuses}</option>
            <option value="subscribed">{t.contacts.filterSubscribed}</option>
            <option value="unsubscribed">{t.contacts.filterUnsubscribed}</option>
          </select>
          <select
            value={groupFilter}
            onChange={(e) => { setGroupFilter(e.target.value); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t.contacts.filterAllGroups}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <span className="text-sm text-muted-foreground ml-auto">{filtered.length} {t.contacts.totalCount}</span>
        </div>

        {/* Batch toolbar */}
        {selectedIds.size > 0 && (
          <div className="px-4 py-2.5 bg-accent/40 border-b border-border/50 flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">{selectedIds.size} {t.contacts.selected}</span>
            {groups.length > 0 && (
              <div className="relative" ref={batchGroupRef}>
                <Button variant="outline" size="sm" onClick={() => setBatchGroupOpen((o) => !o)}>
                  <Users className="h-3.5 w-3.5 mr-1.5" />{t.contacts.addToGroup}
                  <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                </Button>
                {batchGroupOpen && (
                  <div className="absolute top-full left-0 mt-1 z-20 bg-background border border-border rounded-md shadow-md min-w-[160px] py-1">
                    {groups.map((g) => (
                      <button key={g.id} type="button" onClick={() => handleBatchAddGroup(g.id)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getGroupClasses(g.color)}`}>{g.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Button
              variant="outline" size="sm"
              onClick={() => { if (selectedIds.size > 0) setDeleteConfirmOpen(true); }}
              className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t.contacts.deleteSelected}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="ml-auto text-muted-foreground">
              {t.contacts.cancelSelection}
            </Button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">{t.contacts.noContacts}</div>
        ) : (
          <ContactsTable
            contacts={contacts}
            filtered={filtered}
            groups={groups}
            selectedIds={selectedIds}
            page={page}
            allPageSelected={allPageSelected}
            somePageSelected={somePageSelected}
            onToggleSelectAll={toggleSelectAll}
            onToggleSelect={toggleSelect}
            onEdit={openEdit}
            onDuplicate={openDuplicate}
            onDelete={handleDelete}
            onToggleContactGroup={toggleContactGroup}
            onSetPage={setPage}
          />
        )}
      </div>

      {/* Import Preview Dialog */}
      <ImportPreviewDialog
        importPreview={importPreview}
        onClose={() => setImportPreview(null)}
        onConfirm={confirmImport}
      />

      {/* Contact Form Dialog */}
      <ContactFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingContact={editingContact}
        formData={formData}
        formErrors={formErrors}
        openSections={openSections}
        groups={groups}
        onUpdateField={updateField}
        onToggleSection={(key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))}
        onToggleGroup={toggleGroup}
        onSave={handleSave}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedIds.size > 0 ? "Delete Multiple Contacts" : "Delete Contact"}</DialogTitle>
          </DialogHeader>
          {selectedIds.size > 0 ? (
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <span className="font-medium text-foreground">{selectedIds.size} contact(s)</span>? This action cannot be undone.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete <span className="font-medium text-foreground">{contactToDelete?.firstName} {contactToDelete?.lastName}</span>? This action cannot be undone.
              </p>
              {contactToDelete && contacts.filter((c) => c.emailLower === contactToDelete.emailLower).length > 1 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  <span className="font-medium">Attention :</span> {contacts.filter((c) => c.emailLower === contactToDelete.emailLower).length} contacts partagent l'adresse{" "}
                  <span className="font-medium">{contactToDelete.emailLower}</span>. Seul ce contact sera supprimé.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteConfirmOpen(false); setContactToDelete(null); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => { selectedIds.size > 0 ? confirmBatchDelete() : confirmDelete(); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Confirmation Dialog */}
      <Dialog open={duplicateConfirmOpen} onOpenChange={setDuplicateConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dupliquer le contact</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Voulez-vous dupliquer <span className="font-medium text-foreground">{contactToDuplicate?.firstName} {contactToDuplicate?.lastName}</span> ? Un nouveau contact sera créé avec les mêmes informations mais sans adresse email.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDuplicateConfirmOpen(false); setContactToDuplicate(null); }}>
              {t.contactForm.cancel}
            </Button>
            <Button onClick={confirmDuplicate} className="gradient-terracotta text-white hover:opacity-90">
              <Copy className="h-4 w-4 mr-2" />Dupliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
