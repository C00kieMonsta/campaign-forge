import { useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@packages/ui";
import { ChevronLeft, ChevronRight, Copy, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Contact, ContactGroup } from "./types";
import { getGroupClasses, SOURCE_CLASSES, SOURCE_LABELS } from "./constants";

const PAGE_SIZE = 25;

interface Props {
  contacts: Contact[];
  filtered: Contact[];
  groups: ContactGroup[];
  selectedIds: Set<string>;
  page: number;
  allPageSelected: boolean;
  somePageSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleSelect: (emailLower: string) => void;
  onEdit: (contact: Contact) => void;
  onDuplicate: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  onToggleContactGroup: (contact: Contact, groupId: string) => void;
  onSetPage: (updater: (p: number) => number) => void;
}

export function ContactsTable({
  filtered,
  groups,
  selectedIds,
  page,
  allPageSelected,
  somePageSelected,
  onToggleSelectAll,
  onToggleSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleContactGroup,
  onSetPage,
}: Props) {
  const { t } = useLanguage();
  const [openGroupPopover, setOpenGroupPopover] = useState<string | null>(null);
  const groupPopoverRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const getContactGroups = (contact: Contact) => groups.filter((g) => contact.groups?.includes(g.id));
  const getPhone = (contact: Contact) => contact.mobilePhone || contact.homePhone || "—";

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                onCheckedChange={onToggleSelectAll}
                aria-label="Select all on page"
              />
            </TableHead>
            <TableHead>{t.contacts.name}</TableHead>
            <TableHead>{t.contacts.email}</TableHead>
            <TableHead>{t.contacts.phone}</TableHead>
            <TableHead>{t.contacts.groups}</TableHead>
            <TableHead>{t.contacts.status}</TableHead>
            <TableHead className="w-24">{t.contacts.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginated.map((contact) => (
            <TableRow key={contact.emailLower} className={selectedIds.has(contact.emailLower) ? "bg-accent/30" : undefined}>
              <TableCell>
                <Checkbox
                  checked={selectedIds.has(contact.emailLower)}
                  onCheckedChange={() => onToggleSelect(contact.emailLower)}
                  aria-label={`Select ${contact.email}`}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{contact.firstName} {contact.lastName}</span>
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
              <TableCell className="text-muted-foreground">{contact.email}</TableCell>
              <TableCell className="text-muted-foreground">{getPhone(contact)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1 items-center">
                  {getContactGroups(contact).map((g) => (
                    <span key={g.id} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getGroupClasses(g.color)}`}>
                      {g.name}
                    </span>
                  ))}
                  {groups.length > 0 && (
                    <div
                      className="relative"
                      ref={openGroupPopover === contact.emailLower ? groupPopoverRef : null}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenGroupPopover(openGroupPopover === contact.emailLower ? null : contact.emailLower)}
                        title={t.contacts.manageGroups}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-foreground/60 hover:text-foreground transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      {openGroupPopover === contact.emailLower && (
                        <div className="absolute top-full left-0 mt-1 z-20 bg-background border border-border rounded-md shadow-md min-w-[180px] py-1">
                          {groups.map((g) => {
                            const assigned = (contact.groups ?? []).includes(g.id);
                            return (
                              <button
                                key={g.id}
                                type="button"
                                onClick={() => onToggleContactGroup(contact, g.id)}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2.5"
                              >
                                <Checkbox checked={assigned} className="pointer-events-none" aria-hidden />
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getGroupClasses(g.color)}`}>
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
                <div className="flex flex-col gap-1">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border w-fit ${contact.status === "subscribed" ? "bg-green-50 text-green-700 border-green-200" : "bg-secondary text-secondary-foreground border-border"}`}>
                    {contact.status}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border w-fit ${SOURCE_CLASSES[contact.source] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                    {SOURCE_LABELS[contact.source] ?? contact.source}
                  </span>
                </div>
              </TableCell>
              <TableCell className="w-24">
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(contact)} title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDuplicate(contact)} title="Duplicate">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(contact)} title="Delete">
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-border/50 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)}{" "}
            {t.contacts.paginationOf} {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => onSetPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 tabular-nums">{currentPage} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => onSetPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
