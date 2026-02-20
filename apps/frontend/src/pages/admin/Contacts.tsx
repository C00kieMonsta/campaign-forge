import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
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
  TableRow,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@packages/ui";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface Contact {
  emailLower: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email2?: string;
  homePhone?: string;
  businessPhone?: string;
  mobilePhone?: string;
  homeStreet?: string;
  homeAddress2?: string;
  homeCity?: string;
  homePostalCode?: string;
  homeCountry?: string;
  businessAddress?: string;
  businessAddress2?: string;
  businessCity?: string;
  businessState?: string;
  businessPostalCode?: string;
  businessCountry?: string;
  organization?: string;
  notes?: string;
  birthday?: string;
  groups?: string[];
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface ContactGroup {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  displayName: string;
  email2: string;
  homePhone: string;
  businessPhone: string;
  mobilePhone: string;
  homeStreet: string;
  homeAddress2: string;
  homeCity: string;
  homePostalCode: string;
  homeCountry: string;
  businessAddress: string;
  businessAddress2: string;
  businessCity: string;
  businessState: string;
  businessPostalCode: string;
  businessCountry: string;
  organization: string;
  notes: string;
  birthday: string;
  groups: string[];
}

const emptyForm: FormData = {
  firstName: "",
  lastName: "",
  email: "",
  displayName: "",
  email2: "",
  homePhone: "",
  businessPhone: "",
  mobilePhone: "",
  homeStreet: "",
  homeAddress2: "",
  homeCity: "",
  homePostalCode: "",
  homeCountry: "",
  businessAddress: "",
  businessAddress2: "",
  businessCity: "",
  businessState: "",
  businessPostalCode: "",
  businessCountry: "",
  organization: "",
  notes: "",
  birthday: "",
  groups: []
};

const groupColorMap: Record<string, string> = {
  red: "bg-red-100 text-red-700 border-red-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  green: "bg-green-100 text-green-700 border-green-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  pink: "bg-pink-100 text-pink-700 border-pink-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200"
};

function getGroupClasses(color: string) {
  return groupColorMap[color] ?? "bg-gray-100 text-gray-700 border-gray-200";
}

const CSV_COLUMNS: { header: string; field: keyof Contact | "group" }[] = [
  { header: "First Name", field: "firstName" },
  { header: "Last Name", field: "lastName" },
  { header: "Display Name", field: "displayName" },
  { header: "E-mail Address", field: "email" },
  { header: "E-mail 2 Address", field: "email2" },
  { header: "Home Phone", field: "homePhone" },
  { header: "Business Phone", field: "businessPhone" },
  { header: "Mobile Phone", field: "mobilePhone" },
  { header: "Home Street", field: "homeStreet" },
  { header: "Home Address 2", field: "homeAddress2" },
  { header: "Home City", field: "homeCity" },
  { header: "Home Postal Code", field: "homePostalCode" },
  { header: "Home Country", field: "homeCountry" },
  { header: "Business Address", field: "businessAddress" },
  { header: "Business Address 2", field: "businessAddress2" },
  { header: "Business City", field: "businessCity" },
  { header: "Business State", field: "businessState" },
  { header: "Business Postal Code", field: "businessPostalCode" },
  { header: "Business Country", field: "businessCountry" },
  { header: "Organization", field: "organization" },
  { header: "Notes", field: "notes" },
  { header: "Birthday", field: "birthday" },
  { header: "Group", field: "group" }
];

const AUTO_COLORS = [
  "red",
  "blue",
  "green",
  "amber",
  "purple",
  "pink",
  "teal",
  "orange"
];

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] ?? "").trim();
    });
    return row;
  });
}

function downloadTemplate() {
  const headers = CSV_COLUMNS.map((c) => c.header).join(",");
  const blob = new Blob([headers + "\n"], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "contacts-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

interface ImportPreview {
  toImport: { contact: Partial<Contact>; groupNames: string[] }[];
  skipped: number;
  duplicates: number;
  newGroupNames: string[];
}

const PAGE_SIZE = 25;

export default function Contacts() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<ContactGroup[]>([]);

  const loadContacts = useCallback(async () => {
    try {
      setLoading(true);
      const [contactsRes, groupsData] = await Promise.all([
        api.contacts.list({ limit: 200 }),
        api.groups.list(),
      ]);
      setContacts(contactsRes.items);
      setGroups(groupsData);
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "subscribed" | "unsubscribed"
  >("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");

  // Pagination
  const [page, setPage] = useState(1);

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchGroupOpen, setBatchGroupOpen] = useState(false);
  const batchGroupRef = useRef<HTMLDivElement>(null);

  // Inline group popover
  const [openGroupPopover, setOpenGroupPopover] = useState<string | null>(null);
  const groupPopoverRef = useRef<HTMLDivElement>(null);

  // Form dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basic: true
  });

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null
  );

  // Close popovers on outside click
  useEffect(() => {
    if (!openGroupPopover && !batchGroupOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        openGroupPopover &&
        groupPopoverRef.current &&
        !groupPopoverRef.current.contains(e.target as Node)
      ) {
        setOpenGroupPopover(null);
      }
      if (
        batchGroupOpen &&
        batchGroupRef.current &&
        !batchGroupRef.current.contains(e.target as Node)
      ) {
        setBatchGroupOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openGroupPopover, batchGroupOpen]);

  // Filtered contacts
  const filtered = contacts.filter((c) => {
    const q = searchQuery.toLowerCase();
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
    const matchesSearch =
      !q || name.includes(q) || c.email.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const matchesGroup =
      groupFilter === "all" || (c.groups ?? []).includes(groupFilter);
    return matchesSearch && matchesStatus && matchesGroup;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Selection helpers
  const allPageSelected =
    paginated.length > 0 &&
    paginated.every((c) => selectedIds.has(c.emailLower));
  const somePageSelected = paginated.some((c) => selectedIds.has(c.emailLower));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        paginated.forEach((c) => next.delete(c.emailLower));
      } else {
        paginated.forEach((c) => next.add(c.emailLower));
      }
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
        prev.map((c) =>
          selectedIds.has(c.emailLower) ? { ...c, groups: [...new Set([...(c.groups ?? []), groupId])] } : c
        )
      );
      setSelectedIds(new Set());
      setBatchGroupOpen(false);
      toast({ title: `${t.contacts.batchGroupAdded} ${count} ${t.contacts.batchContacts}` });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const handleBatchDelete = () => {
    setContactToDelete({ emailLower: "", email: "", status: "", source: "", createdAt: "", updatedAt: "" } as Contact);
    setDeleteConfirmOpen(true);
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

  const toggleContactGroup = async (contact: Contact, groupId: string) => {
    const curr = contact.groups ?? [];
    const next = curr.includes(groupId) ? curr.filter((id) => id !== groupId) : [...curr, groupId];
    const groupsArr = next.length > 0 ? next : undefined;
    try {
      await api.contacts.update(contact.emailLower, { groups: groupsArr });
      setContacts((prev) =>
        prev.map((c) => (c.emailLower === contact.emailLower ? { ...c, groups: groupsArr } : c))
      );
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const updateField = (field: keyof FormData, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const toggleGroup = (groupId: string) =>
    setFormData((prev) => ({
      ...prev,
      groups: prev.groups.includes(groupId)
        ? prev.groups.filter((id) => id !== groupId)
        : [...prev.groups, groupId]
    }));

  const openCreate = () => {
    setEditingContact(null);
    setFormData(emptyForm);
    setOpenSections({ basic: true });
    setIsDialogOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      firstName: contact.firstName ?? "",
      lastName: contact.lastName ?? "",
      email: contact.email,
      displayName: contact.displayName ?? "",
      email2: contact.email2 ?? "",
      homePhone: contact.homePhone ?? "",
      businessPhone: contact.businessPhone ?? "",
      mobilePhone: contact.mobilePhone ?? "",
      homeStreet: contact.homeStreet ?? "",
      homeAddress2: contact.homeAddress2 ?? "",
      homeCity: contact.homeCity ?? "",
      homePostalCode: contact.homePostalCode ?? "",
      homeCountry: contact.homeCountry ?? "",
      businessAddress: contact.businessAddress ?? "",
      businessAddress2: contact.businessAddress2 ?? "",
      businessCity: contact.businessCity ?? "",
      businessState: contact.businessState ?? "",
      businessPostalCode: contact.businessPostalCode ?? "",
      businessCountry: contact.businessCountry ?? "",
      organization: contact.organization ?? "",
      notes: contact.notes ?? "",
      birthday: contact.birthday ?? "",
      groups: contact.groups ?? []
    });
    setOpenSections({ basic: true });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.firstName || !formData.lastName || !formData.email) return;

    const fields = {
      firstName: formData.firstName || undefined,
      lastName: formData.lastName || undefined,
      displayName: formData.displayName || undefined,
      email2: formData.email2 || undefined,
      homePhone: formData.homePhone || undefined,
      businessPhone: formData.businessPhone || undefined,
      mobilePhone: formData.mobilePhone || undefined,
      homeStreet: formData.homeStreet || undefined,
      homeAddress2: formData.homeAddress2 || undefined,
      homeCity: formData.homeCity || undefined,
      homePostalCode: formData.homePostalCode || undefined,
      homeCountry: formData.homeCountry || undefined,
      businessAddress: formData.businessAddress || undefined,
      businessAddress2: formData.businessAddress2 || undefined,
      businessCity: formData.businessCity || undefined,
      businessState: formData.businessState || undefined,
      businessPostalCode: formData.businessPostalCode || undefined,
      businessCountry: formData.businessCountry || undefined,
      organization: formData.organization || undefined,
      notes: formData.notes || undefined,
      birthday: formData.birthday || undefined,
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({ title: "Empty CSV file", variant: "destructive" });
        return;
      }

      const headerMap = new Map<string, string>();
      for (const col of CSV_COLUMNS) {
        headerMap.set(col.header.toLowerCase(), col.field);
      }

      const existingEmails = new Set(contacts.map((c) => c.emailLower));
      const existingGroupNames = new Map(
        groups.map((g) => [g.name.toLowerCase(), g.id])
      );

      let skipped = 0;
      let duplicates = 0;
      const newGroupNamesSet = new Set<string>();
      const toImport: ImportPreview["toImport"] = [];

      for (const row of rows) {
        const mapped: Record<string, string> = {};
        let groupRaw = "";
        for (const [csvHeader, value] of Object.entries(row)) {
          const field = headerMap.get(csvHeader.toLowerCase().trim());
          if (field === "group") {
            groupRaw = value;
          } else if (field) {
            mapped[field] = value;
          }
        }

        const email = mapped.email?.trim();
        if (!email || !email.includes("@")) {
          skipped++;
          continue;
        }
        if (existingEmails.has(email.toLowerCase())) {
          duplicates++;
          continue;
        }
        existingEmails.add(email.toLowerCase());

        const groupNames = groupRaw
          .split(";")
          .map((g) => g.trim())
          .filter(Boolean);

        for (const gn of groupNames) {
          if (!existingGroupNames.has(gn.toLowerCase())) {
            newGroupNamesSet.add(gn);
            existingGroupNames.set(gn.toLowerCase(), "__pending__");
          }
        }

        const contact: Partial<Contact> = {
          email,
          emailLower: email.toLowerCase(),
          firstName: mapped.firstName || undefined,
          lastName: mapped.lastName || undefined,
          displayName: mapped.displayName || undefined,
          email2: mapped.email2 || undefined,
          homePhone: mapped.homePhone || undefined,
          businessPhone: mapped.businessPhone || undefined,
          mobilePhone: mapped.mobilePhone || undefined,
          homeStreet: mapped.homeStreet || undefined,
          homeAddress2: mapped.homeAddress2 || undefined,
          homeCity: mapped.homeCity || undefined,
          homePostalCode: mapped.homePostalCode || undefined,
          homeCountry: mapped.homeCountry || undefined,
          businessAddress: mapped.businessAddress || undefined,
          businessAddress2: mapped.businessAddress2 || undefined,
          businessCity: mapped.businessCity || undefined,
          businessState: mapped.businessState || undefined,
          businessPostalCode: mapped.businessPostalCode || undefined,
          businessCountry: mapped.businessCountry || undefined,
          organization: mapped.organization || undefined,
          notes: mapped.notes || undefined,
          birthday: mapped.birthday || undefined
        };

        toImport.push({ contact, groupNames });
      }

      setImportPreview({
        toImport,
        skipped,
        duplicates,
        newGroupNames: [...newGroupNamesSet]
      });
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!importPreview) return;

    try {
      for (let i = 0; i < importPreview.newGroupNames.length; i++) {
        const color = AUTO_COLORS[i % AUTO_COLORS.length];
        await api.groups.create({ name: importPreview.newGroupNames[i], color });
      }

      const esc = (v: string) => `"${String(v || "").replace(/"/g, '""')}"`;
      const csvLines = ["email,firstName,lastName", ...importPreview.toImport.map(({ contact }) =>
        [esc(contact.email ?? ""), esc(contact.firstName ?? ""), esc(contact.lastName ?? "")].join(",")
      )];

      const result = await api.contacts.importCsv(csvLines.join("\n"));
      setImportPreview(null);
      await loadContacts();
      toast({ title: `${result.imported} ${t.contacts.importSuccess}` });
    } catch (err) {
      toast({ title: String(err), variant: "destructive" });
    }
  };

  const getContactGroups = (contact: Contact) =>
    groups.filter((g) => contact.groups?.includes(g.id));

  const getPhone = (contact: Contact) =>
    contact.mobilePhone || contact.homePhone || "—";

  const SectionToggle = ({
    sectionKey,
    label
  }: {
    sectionKey: string;
    label: string;
  }) => (
    <button
      type="button"
      onClick={() => toggleSection(sectionKey)}
      className="flex items-center gap-2 w-full text-left font-medium text-sm py-2"
    >
      {openSections[sectionKey] ? (
        <ChevronDown className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
      {label}
    </button>
  );

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t.contacts.title}
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            {t.contacts.downloadTemplate}
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            {t.contacts.importCsv}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            onClick={openCreate}
            className="gradient-terracotta text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t.contacts.addNew}
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t.contacts.filterAllStatuses}</option>
            <option value="subscribed">{t.contacts.filterSubscribed}</option>
            <option value="unsubscribed">
              {t.contacts.filterUnsubscribed}
            </option>
          </select>
          <select
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t.contacts.filterAllGroups}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground ml-auto">
            {filtered.length} {t.contacts.totalCount}
          </span>
        </div>

        {/* Batch action toolbar */}
        {selectedIds.size > 0 && (
          <div className="px-4 py-2.5 bg-accent/40 border-b border-border/50 flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size} {t.contacts.selected}
            </span>

            {groups.length > 0 && (
              <div className="relative" ref={batchGroupRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchGroupOpen((o) => !o)}
                >
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  {t.contacts.addToGroup}
                  <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
                </Button>
                {batchGroupOpen && (
                  <div className="absolute top-full left-0 mt-1 z-20 bg-background border border-border rounded-md shadow-md min-w-[160px] py-1">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleBatchAddGroup(g.id)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
                      >
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getGroupClasses(g.color)}`}
                        >
                          {g.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (selectedIds.size === 0) return;
                setDeleteConfirmOpen(true);
              }}
              className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t.contacts.deleteSelected}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-muted-foreground"
            >
              {t.contacts.cancelSelection}
            </Button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {t.contacts.noContacts}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        allPageSelected
                          ? true
                          : somePageSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all on page"
                    />
                  </TableHead>
                  <TableHead>{t.contacts.name}</TableHead>
                  <TableHead>{t.contacts.email}</TableHead>
                  <TableHead>{t.contacts.phone}</TableHead>
                  <TableHead>{t.contacts.groups}</TableHead>
                  <TableHead>{t.contacts.status}</TableHead>
                  <TableHead className="w-20">{t.contacts.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((contact) => (
                  <TableRow
                    key={contact.emailLower}
                    className={
                      selectedIds.has(contact.emailLower)
                        ? "bg-accent/30"
                        : undefined
                    }
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(contact.emailLower)}
                        onCheckedChange={() => toggleSelect(contact.emailLower)}
                        aria-label={`Select ${contact.email}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">
                          {contact.firstName} {contact.lastName}
                        </span>
                        {contact.notes && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                                <MessageSquare className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[260px] whitespace-pre-wrap">
                              {contact.notes}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.email}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {getPhone(contact)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 items-center">
                        {getContactGroups(contact).map((g) => (
                          <span
                            key={g.id}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getGroupClasses(g.color)}`}
                          >
                            {g.name}
                          </span>
                        ))}
                        {groups.length > 0 && (
                          <div
                            className="relative"
                            ref={
                              openGroupPopover === contact.emailLower
                                ? groupPopoverRef
                                : null
                            }
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenGroupPopover(
                                  openGroupPopover === contact.emailLower
                                    ? null
                                    : contact.emailLower
                                )
                              }
                              title={t.contacts.manageGroups}
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-foreground/60 hover:text-foreground transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                            {openGroupPopover === contact.emailLower && (
                              <div className="absolute top-full left-0 mt-1 z-20 bg-background border border-border rounded-md shadow-md min-w-[180px] py-1">
                                {groups.map((g) => {
                                  const assigned = (
                                    contact.groups ?? []
                                  ).includes(g.id);
                                  return (
                                    <button
                                      key={g.id}
                                      type="button"
                                      onClick={() =>
                                        toggleContactGroup(contact, g.id)
                                      }
                                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2.5"
                                    >
                                      <Checkbox
                                        checked={assigned}
                                        className="pointer-events-none"
                                        aria-hidden
                                      />
                                      <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getGroupClasses(g.color)}`}
                                      >
                                        {g.name}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          contact.status === "subscribed"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-secondary text-secondary-foreground border-border"
                        }`}
                      >
                        {contact.status}
                      </span>
                    </TableCell>
                    <TableCell className="w-20">
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(contact)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDelete(contact)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border/50 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, filtered.length)}{" "}
                  {t.contacts.paginationOf} {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-3 tabular-nums">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Import Preview Dialog */}
      <Dialog
        open={!!importPreview}
        onOpenChange={(open) => {
          if (!open) setImportPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.contacts.importPreviewTitle}</DialogTitle>
          </DialogHeader>
          {importPreview && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-green-600 font-medium">
                    ✓ {importPreview.toImport.length}{" "}
                    {t.contacts.importToImport}
                  </span>
                </div>
                {importPreview.skipped > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-600">
                      ⚠ {importPreview.skipped} {t.contacts.importSkipped}
                    </span>
                  </div>
                )}
                {importPreview.duplicates > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      ↔ {importPreview.duplicates}{" "}
                      {t.contacts.importDuplicates}
                    </span>
                  </div>
                )}
                {importPreview.newGroupNames.length > 0 && (
                  <div className="text-sm space-y-1">
                    <span className="text-blue-600">
                      + {importPreview.newGroupNames.length}{" "}
                      {t.contacts.importNewGroups}
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {importPreview.newGroupNames.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)}>
              {t.contactForm.cancel}
            </Button>
            <Button
              onClick={confirmImport}
              disabled={!importPreview || importPreview.toImport.length === 0}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {t.contacts.importConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Form Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingContact ? t.contactForm.editTitle : t.contactForm.title}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[80vh] overflow-y-auto space-y-1 py-2">
            <SectionToggle sectionKey="basic" label={t.contactForm.basicInfo} />
            {openSections.basic && (
              <div className="space-y-3 pl-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>{t.contactForm.firstName} *</Label>
                    <Input
                      value={formData.firstName}
                      onChange={(e) => updateField("firstName", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t.contactForm.lastName} *</Label>
                    <Input
                      value={formData.lastName}
                      onChange={(e) => updateField("lastName", e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.email} *</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.displayName}</Label>
                  <Input
                    value={formData.displayName}
                    onChange={(e) => updateField("displayName", e.target.value)}
                  />
                </div>
              </div>
            )}

            <SectionToggle
              sectionKey="additional"
              label={t.contactForm.additionalContact}
            />
            {openSections.additional && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1">
                  <Label>{t.contactForm.email2}</Label>
                  <Input
                    type="email"
                    value={formData.email2}
                    onChange={(e) => updateField("email2", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.homePhone}</Label>
                  <Input
                    value={formData.homePhone}
                    onChange={(e) => updateField("homePhone", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.businessPhone}</Label>
                  <Input
                    value={formData.businessPhone}
                    onChange={(e) =>
                      updateField("businessPhone", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.mobilePhone}</Label>
                  <Input
                    value={formData.mobilePhone}
                    onChange={(e) => updateField("mobilePhone", e.target.value)}
                  />
                </div>
              </div>
            )}

            <SectionToggle
              sectionKey="homeAddress"
              label={t.contactForm.homeAddress}
            />
            {openSections.homeAddress && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1">
                  <Label>{t.contactForm.street}</Label>
                  <Input
                    value={formData.homeStreet}
                    onChange={(e) => updateField("homeStreet", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.address2}</Label>
                  <Input
                    value={formData.homeAddress2}
                    onChange={(e) =>
                      updateField("homeAddress2", e.target.value)
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>{t.contactForm.city}</Label>
                    <Input
                      value={formData.homeCity}
                      onChange={(e) => updateField("homeCity", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t.contactForm.postalCode}</Label>
                    <Input
                      value={formData.homePostalCode}
                      onChange={(e) =>
                        updateField("homePostalCode", e.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.country}</Label>
                  <Input
                    value={formData.homeCountry}
                    onChange={(e) => updateField("homeCountry", e.target.value)}
                  />
                </div>
              </div>
            )}

            <SectionToggle
              sectionKey="businessAddress"
              label={t.contactForm.businessAddress}
            />
            {openSections.businessAddress && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1">
                  <Label>{t.contactForm.street}</Label>
                  <Input
                    value={formData.businessAddress}
                    onChange={(e) =>
                      updateField("businessAddress", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.address2}</Label>
                  <Input
                    value={formData.businessAddress2}
                    onChange={(e) =>
                      updateField("businessAddress2", e.target.value)
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>{t.contactForm.city}</Label>
                    <Input
                      value={formData.businessCity}
                      onChange={(e) =>
                        updateField("businessCity", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t.contactForm.state}</Label>
                    <Input
                      value={formData.businessState}
                      onChange={(e) =>
                        updateField("businessState", e.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>{t.contactForm.postalCode}</Label>
                    <Input
                      value={formData.businessPostalCode}
                      onChange={(e) =>
                        updateField("businessPostalCode", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t.contactForm.country}</Label>
                    <Input
                      value={formData.businessCountry}
                      onChange={(e) =>
                        updateField("businessCountry", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            <SectionToggle sectionKey="other" label={t.contactForm.other} />
            {openSections.other && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1">
                  <Label>{t.contactForm.organization}</Label>
                  <Input
                    value={formData.organization}
                    onChange={(e) =>
                      updateField("organization", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.birthday}</Label>
                  <Input
                    type="date"
                    value={formData.birthday}
                    onChange={(e) => updateField("birthday", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.notes}</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
            )}

            <SectionToggle sectionKey="groups" label={t.contactForm.groups} />
            {openSections.groups && (
              <div className="pl-6">
                {groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-1">
                    No groups available
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 py-1">
                    {groups.map((g) => {
                      const selected = formData.groups.includes(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => toggleGroup(g.id)}
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border transition-opacity ${getGroupClasses(g.color)} ${selected ? "opacity-100 ring-2 ring-offset-1 ring-current" : "opacity-50"}`}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t.contactForm.cancel}
            </Button>
            <Button
              onClick={handleSave}
              className="gradient-terracotta text-white hover:opacity-90"
            >
              {t.contactForm.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedIds.size > 0 ? "Delete Multiple Contacts" : "Delete Contact"}
            </DialogTitle>
          </DialogHeader>
          {selectedIds.size > 0 ? (
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{selectedIds.size} contact(s)</span>? 
              This action cannot be undone.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                {contactToDelete?.firstName} {contactToDelete?.lastName}
              </span>
              ? This action cannot be undone.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteConfirmOpen(false);
                setContactToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedIds.size > 0) {
                  confirmBatchDelete();
                } else {
                  confirmDelete();
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
