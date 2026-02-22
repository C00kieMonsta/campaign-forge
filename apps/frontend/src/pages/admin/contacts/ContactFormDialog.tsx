import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@packages/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Contact, ContactGroup, ContactFormData, ContactFormErrors } from "./types";
import { SOURCE_LABELS, SOURCE_CLASSES, getGroupClasses } from "./constants";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingContact: Contact | null;
  formData: ContactFormData;
  formErrors: ContactFormErrors;
  openSections: Record<string, boolean>;
  groups: ContactGroup[];
  onUpdateField: (field: keyof ContactFormData, value: string) => void;
  onToggleSection: (key: string) => void;
  onToggleGroup: (groupId: string) => void;
  onSave: () => void;
}

function SectionToggle({ sectionKey, label, openSections, onToggle }: {
  sectionKey: string;
  label: string;
  openSections: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(sectionKey)}
      className="flex items-center gap-2 w-full text-left font-medium text-sm py-2"
    >
      {openSections[sectionKey] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      {label}
    </button>
  );
}

export function ContactFormDialog({
  open,
  onOpenChange,
  editingContact,
  formData,
  formErrors,
  openSections,
  groups,
  onUpdateField,
  onToggleSection,
  onToggleGroup,
  onSave,
}: Props) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editingContact ? t.contactForm.editTitle : t.contactForm.title}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[80vh] overflow-y-auto space-y-1 py-2">

          {/* Basic Info */}
          <SectionToggle sectionKey="basic" label={t.contactForm.basicInfo} openSections={openSections} onToggle={onToggleSection} />
          {openSections.basic && (
            <div className="space-y-3 pl-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t.contactForm.firstName} *</Label>
                  <Input
                    value={formData.firstName}
                    onChange={(e) => onUpdateField("firstName", e.target.value)}
                    className={formErrors.firstName ? "border-destructive" : ""}
                  />
                  {formErrors.firstName && <p className="text-xs text-destructive">{formErrors.firstName}</p>}
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.lastName} *</Label>
                  <Input
                    value={formData.lastName}
                    onChange={(e) => onUpdateField("lastName", e.target.value)}
                    className={formErrors.lastName ? "border-destructive" : ""}
                  />
                  {formErrors.lastName && <p className="text-xs text-destructive">{formErrors.lastName}</p>}
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.email} *</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => onUpdateField("email", e.target.value)}
                  readOnly={!!editingContact}
                  className={
                    editingContact
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : formErrors.email
                      ? "border-destructive"
                      : ""
                  }
                />
                {formErrors.email && <p className="text-xs text-destructive">{formErrors.email}</p>}
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.displayName}</Label>
                <Input
                  value={formData.displayName}
                  onChange={(e) => onUpdateField("displayName", e.target.value)}
                />
              </div>
              {editingContact && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground pt-1">
                  <span>Source :</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${SOURCE_CLASSES[editingContact.source] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                    {SOURCE_LABELS[editingContact.source] ?? editingContact.source}
                  </span>
                  <span className="ml-auto text-xs">
                    Créé le {new Date(editingContact.createdAt).toLocaleDateString("fr-BE")}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Additional Contact */}
          <SectionToggle sectionKey="additional" label={t.contactForm.additionalContact} openSections={openSections} onToggle={onToggleSection} />
          {openSections.additional && (
            <div className="space-y-3 pl-6">
              <div className="space-y-1">
                <Label>{t.contactForm.email2}</Label>
                <Input type="email" value={formData.email2} onChange={(e) => onUpdateField("email2", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.homePhone}</Label>
                <Input value={formData.homePhone} onChange={(e) => onUpdateField("homePhone", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.businessPhone}</Label>
                <Input value={formData.businessPhone} onChange={(e) => onUpdateField("businessPhone", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.mobilePhone}</Label>
                <Input value={formData.mobilePhone} onChange={(e) => onUpdateField("mobilePhone", e.target.value)} />
              </div>
            </div>
          )}

          {/* Home Address */}
          <SectionToggle sectionKey="homeAddress" label={t.contactForm.homeAddress} openSections={openSections} onToggle={onToggleSection} />
          {openSections.homeAddress && (
            <div className="space-y-3 pl-6">
              <div className="space-y-1">
                <Label>{t.contactForm.street}</Label>
                <Input value={formData.homeStreet} onChange={(e) => onUpdateField("homeStreet", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.address2}</Label>
                <Input value={formData.homeAddress2} onChange={(e) => onUpdateField("homeAddress2", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t.contactForm.city}</Label>
                  <Input value={formData.homeCity} onChange={(e) => onUpdateField("homeCity", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.postalCode}</Label>
                  <Input value={formData.homePostalCode} onChange={(e) => onUpdateField("homePostalCode", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.country}</Label>
                <Input value={formData.homeCountry} onChange={(e) => onUpdateField("homeCountry", e.target.value)} />
              </div>
            </div>
          )}

          {/* Business Address */}
          <SectionToggle sectionKey="businessAddress" label={t.contactForm.businessAddress} openSections={openSections} onToggle={onToggleSection} />
          {openSections.businessAddress && (
            <div className="space-y-3 pl-6">
              <div className="space-y-1">
                <Label>{t.contactForm.street}</Label>
                <Input value={formData.businessAddress} onChange={(e) => onUpdateField("businessAddress", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.address2}</Label>
                <Input value={formData.businessAddress2} onChange={(e) => onUpdateField("businessAddress2", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t.contactForm.city}</Label>
                  <Input value={formData.businessCity} onChange={(e) => onUpdateField("businessCity", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.state}</Label>
                  <Input value={formData.businessState} onChange={(e) => onUpdateField("businessState", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t.contactForm.postalCode}</Label>
                  <Input value={formData.businessPostalCode} onChange={(e) => onUpdateField("businessPostalCode", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t.contactForm.country}</Label>
                  <Input value={formData.businessCountry} onChange={(e) => onUpdateField("businessCountry", e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* Other */}
          <SectionToggle sectionKey="other" label={t.contactForm.other} openSections={openSections} onToggle={onToggleSection} />
          {openSections.other && (
            <div className="space-y-3 pl-6">
              <div className="space-y-1">
                <Label>{t.contactForm.organization}</Label>
                <Input value={formData.organization} onChange={(e) => onUpdateField("organization", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.birthday}</Label>
                <Input type="date" value={formData.birthday} onChange={(e) => onUpdateField("birthday", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t.contactForm.notes}</Label>
                <Textarea value={formData.notes} onChange={(e) => onUpdateField("notes", e.target.value)} rows={3} />
              </div>
            </div>
          )}

          {/* Groups */}
          <SectionToggle sectionKey="groups" label={t.contactForm.groups} openSections={openSections} onToggle={onToggleSection} />
          {openSections.groups && (
            <div className="pl-6">
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground py-1">No groups available</p>
              ) : (
                <div className="flex flex-wrap gap-2 py-1">
                  {groups.map((g) => {
                    const selected = formData.groups.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => onToggleGroup(g.id)}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.contactForm.cancel}
          </Button>
          <Button onClick={onSave} className="gradient-terracotta text-white hover:opacity-90">
            {t.contactForm.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
