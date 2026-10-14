import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CONTACT_CANDIDATE_FIELDS,
  MAX_ASSISTANT_TEXT_CHARS,
  MAX_ASSISTANT_UPLOAD_BYTES,
  MAX_ASSISTANT_VOICE_SECONDS,
  type ContactCandidate,
  type ContactCandidateField,
  type ContactConfidence,
  type CreateContactRequest,
  type ExistingContactSummary
} from "@packages/types";
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
  Textarea
} from "@packages/ui";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  UserPlus,
  Users,
  X
} from "lucide-react";
import VoiceCapture from "@/components/admin/VoiceCapture";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  candidateProblems,
  isValidEmail,
  toCreatePayload,
  type CandidateProblem
} from "@/lib/contactCandidates";
import { errorMessage } from "@/lib/errorMessage";
import { downscaleImage } from "@/lib/imageDownscale";
import { AUTO_COLORS, getGroupClasses } from "./constants";
import type { ContactGroup } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ContactGroup[];
  /** Lowercase emails already in the list, so an edited email is checked against them too. */
  existingEmails: Set<string>;
  onCreated: () => Promise<void> | void;
}

type Step = "capture" | "analyzing" | "review" | "creating";
type Source = "image" | "audio" | "text";
type FieldKey = "email" | ContactCandidateField;
type Fields = Record<FieldKey, string>;

/** One candidate as the review step edits it. */
interface ReviewCandidate {
  id: string;
  fields: Fields;
  selected: boolean;
  groupIds: string[];
  /** Names the source used that match no group. */
  suggestedGroupNames: string[];
  /** The suggested names still ticked, created on confirm. */
  newGroupNames: string[];
  confidence: ContactConfidence;
  issues: string[];
  existing: boolean;
  existingContact: ExistingContactSummary | null;
  /** Why the server skipped this one on the last create, if it did. */
  createError: string | null;
  groupsBusy: boolean;
  groupsAdded: boolean;
  showMore: boolean;
}

const MAIN_FIELDS: readonly FieldKey[] = [
  "firstName",
  "lastName",
  "email",
  "mobilePhone",
  "organization"
];
const MORE_FIELDS = CONTACT_CANDIDATE_FIELDS.filter(
  (f) => !MAIN_FIELDS.includes(f)
);

const IMAGE_EXTENSION = /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?)$/i;

/** Some phones hand over a HEIC with an empty type, so the name is the second opinion. */
function looksLikeImage(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    (!file.type && IMAGE_EXTENSION.test(file.name))
  );
}

function toReview(
  c: ContactCandidate,
  groups: ContactGroup[],
  existingEmails: Set<string>
): ReviewCandidate {
  const fields = { email: c.email ?? "" } as Fields;
  for (const f of CONTACT_CANDIDATE_FIELDS) fields[f] = c[f] ?? "";
  const existing =
    c.existing || existingEmails.has(fields.email.trim().toLowerCase());

  const knownIds = new Set(groups.map((g) => g.id));
  const idByName = new Map(
    groups.map((g) => [g.name.trim().toLowerCase(), g.id])
  );
  const groupIds = (c.groupIds ?? []).filter((id) => knownIds.has(id));
  const suggested: string[] = [];
  for (const raw of c.newGroupNames ?? []) {
    const name = raw.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const known = idByName.get(lower);
    if (known) {
      if (!groupIds.includes(known)) groupIds.push(known);
    } else if (!suggested.some((s) => s.toLowerCase() === lower)) {
      suggested.push(name);
    }
  }

  return {
    id: c.id,
    fields,
    selected: !existing && isValidEmail(fields.email),
    groupIds,
    suggestedGroupNames: suggested,
    newGroupNames: suggested,
    confidence: c.confidence,
    issues: c.issues ?? [],
    existing,
    existingContact: c.existingContact ?? null,
    createError: null,
    groupsBusy: false,
    groupsAdded: false,
    showMore: MORE_FIELDS.some((f) => fields[f].trim() !== "")
  };
}

function toCandidate(c: ReviewCandidate): ContactCandidate {
  const { email, ...rest } = c.fields;
  return {
    id: c.id,
    email,
    ...rest,
    groupIds: c.groupIds,
    newGroupNames: c.newGroupNames,
    confidence: c.confidence,
    issues: c.issues,
    existing: c.existing,
    existingContact: c.existingContact
  };
}

const CONFIDENCE_CLASSES: Record<ContactConfidence, string> = {
  high: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-red-100 text-red-700 border-red-200"
};

const PILL =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium";
const CHIP =
  "inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-opacity disabled:cursor-default";
const TILE =
  "flex min-h-[7rem] w-full flex-col items-center justify-center gap-2 rounded-xl border bg-background px-3 py-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground";
/**
 * Styles VoiceCapture's button like the two photo tiles. Scoped to `> button` so the recording
 * bar (a div) keeps its own row layout and only gets the tile height.
 */
const VOICE_TILE =
  "empty:hidden [&>button]:h-auto [&>button]:min-h-[7rem] [&>button]:w-full [&>button]:flex-col [&>button]:gap-2 [&>button]:rounded-xl [&>button]:px-3 [&>button]:py-4 [&>button]:text-sm [&>button>svg]:!size-6 [&>div]:min-h-[7rem] [&>div]:justify-center";

function Tile({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={TILE}>
      <Icon className="h-6 w-6" />
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  invalid = false,
  hint,
  disabled = false,
  readOnly = false,
  textarea = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  invalid?: boolean;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  textarea?: boolean;
}) {
  const muted = readOnly ? "bg-muted text-muted-foreground" : "";
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {textarea ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          disabled={disabled}
          readOnly={readOnly}
          className={muted}
        />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          className={`h-10 ${invalid ? "border-destructive" : ""} ${muted}`}
        />
      )}
      {hint ? <p className="text-xs text-destructive">{hint}</p> : null}
    </div>
  );
}

interface CardProps {
  c: ReviewCandidate;
  problems: CandidateProblem[];
  groups: ContactGroup[];
  disabled: boolean;
  onField: (key: FieldKey, value: string) => void;
  onSelect: (selected: boolean) => void;
  onToggleMore: () => void;
  onToggleGroup: (groupId: string) => void;
  onToggleNewGroup: (name: string) => void;
  onAddToGroups: () => void;
}

/** Defined at module level so a re-render of the dialog does not remount the inputs. */
function CandidateCard({
  c,
  problems,
  groups,
  disabled,
  onField,
  onSelect,
  onToggleMore,
  onToggleGroup,
  onToggleNewGroup,
  onAddToGroups
}: CardProps) {
  const { t } = useLanguage();
  const ta = t.contactAssistant;
  const tf = t.contactForm;
  const f = c.fields;

  // A contact the server already knows is shown, never edited or re-created.
  const ex = c.existingContact;
  const readOnly = !!ex;
  const exName = ex ? `${ex.firstName ?? ""} ${ex.lastName ?? ""}`.trim() : "";
  const unsubscribed = ex?.status === "unsubscribed";
  const wantsGroups = c.groupIds.length + c.newGroupNames.length > 0;
  const canAddToGroups = !!ex && !unsubscribed && !c.groupsAdded && wantsGroups;
  const chipsDisabled =
    disabled || c.groupsBusy || c.groupsAdded || unsubscribed;

  const emailProblem = problems.find(
    (p): p is Exclude<CandidateProblem, "existing"> => p !== "existing"
  );
  const confidenceLabel = {
    high: ta.confidenceHigh,
    medium: ta.confidenceMedium,
    low: ta.confidenceLow
  }[c.confidence];
  const title =
    f.displayName.trim() ||
    `${f.firstName} ${f.lastName}`.trim() ||
    f.email.trim();

  const text = (key: FieldKey, label: string, type = "text") => (
    <Field
      label={label}
      value={f[key]}
      onChange={(v) => onField(key, v)}
      type={type}
      disabled={disabled}
      readOnly={readOnly}
    />
  );

  return (
    <div
      className={`space-y-3 rounded-xl border p-3 sm:p-4 ${ex ? "bg-muted/40" : c.selected ? "" : "bg-muted/30"}`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-0.5 size-5"
          checked={c.selected}
          disabled={disabled || c.existing}
          onCheckedChange={(v) => onSelect(v === true)}
          aria-label={title}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {title ? (
              <span
                className={`truncate font-medium ${ex ? "text-muted-foreground" : ""}`}
              >
                {title}
              </span>
            ) : null}
            <span className={`${PILL} ${CONFIDENCE_CLASSES[c.confidence]}`}>
              {ta.confidence}: {confidenceLabel}
            </span>
            {ex ? (
              <span
                className={`${PILL} bg-gray-100 text-gray-700 border-gray-200`}
              >
                {ta.alreadyInContacts}
                {exName ? `: ${exName}` : ""}
                {unsubscribed ? ` · ${ta.unsubscribed}` : ""}
              </span>
            ) : c.existing ? (
              <span
                className={`${PILL} bg-gray-100 text-gray-700 border-gray-200`}
              >
                {ta.existing}
              </span>
            ) : null}
          </div>
          {!ex && c.existing ? (
            <p className="text-xs text-muted-foreground">{ta.existingHint}</p>
          ) : null}
          {c.createError ? (
            <p className="text-xs text-destructive">{c.createError}</p>
          ) : null}
          {c.issues.map((issue, i) => (
            <p
              key={i}
              className="flex items-start gap-1 text-xs text-amber-700"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {ta.issues}: {issue}
              </span>
            </p>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text("firstName", tf.firstName)}
        {text("lastName", tf.lastName)}
        <div className="sm:col-span-2">
          <Field
            label={tf.email}
            value={f.email}
            onChange={(v) => onField("email", v)}
            type="email"
            invalid={!!emailProblem}
            hint={emailProblem ? ta[emailProblem] : undefined}
            disabled={disabled}
            readOnly={readOnly}
          />
        </div>
        {text("mobilePhone", tf.mobilePhone, "tel")}
        {text("organization", tf.organization)}
      </div>

      <button
        type="button"
        onClick={onToggleMore}
        className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        {c.showMore ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {tf.other}
      </button>

      {c.showMore ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text("displayName", tf.displayName)}
            {text("email2", tf.email2, "email")}
            {text("homePhone", tf.homePhone, "tel")}
            {text("businessPhone", tf.businessPhone, "tel")}
          </div>
          <p className="text-xs font-medium">{tf.homeAddress}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text("homeStreet", tf.street)}
            {text("homeAddress2", tf.address2)}
            {text("homeCity", tf.city)}
            {text("homePostalCode", tf.postalCode)}
            {text("homeCountry", tf.country)}
          </div>
          <p className="text-xs font-medium">{tf.businessAddress}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text("businessAddress", tf.street)}
            {text("businessAddress2", tf.address2)}
            {text("businessCity", tf.city)}
            {text("businessState", tf.state)}
            {text("businessPostalCode", tf.postalCode)}
            {text("businessCountry", tf.country)}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text("birthday", tf.birthday, "date")}
          </div>
          <Field
            label={tf.notes}
            value={f.notes}
            onChange={(v) => onField("notes", v)}
            disabled={disabled}
            readOnly={readOnly}
            textarea
          />
        </div>
      ) : null}

      {groups.length > 0 || c.suggestedGroupNames.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{ta.groups}</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const on = c.groupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={chipsDisabled}
                  onClick={() => onToggleGroup(g.id)}
                  className={`${CHIP} ${getGroupClasses(g.color)} ${on ? "opacity-100 ring-2 ring-current ring-offset-1" : "opacity-50"}`}
                >
                  {g.name}
                </button>
              );
            })}
            {c.suggestedGroupNames.map((name) => {
              const on = c.newGroupNames.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={chipsDisabled}
                  onClick={() => onToggleNewGroup(name)}
                  className={`${CHIP} border-dashed ${getGroupClasses("")} ${on ? "opacity-100 ring-2 ring-current ring-offset-1" : "opacity-50"}`}
                >
                  {name}
                  <span className="ml-1 font-normal opacity-70">
                    ({ta.newGroup})
                  </span>
                </button>
              );
            })}
          </div>
          {canAddToGroups ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={onAddToGroups}
              disabled={disabled || c.groupsBusy}
            >
              {c.groupsBusy ? <Loader2 className="animate-spin" /> : <Users />}
              {ta.addToGroups}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Adds contacts from a photo, a recording or a pasted text.
 *
 * One extract call, then a review step where every field is editable and nothing is written until
 * the user confirms. Creation goes through the assistant's conditional endpoint only: the ordinary
 * create and import calls replace an existing row and would re-subscribe someone who opted out.
 */
export function ContactAssistantDialog({
  open,
  onOpenChange,
  groups,
  existingEmails,
  onCreated
}: Props) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const ta = t.contactAssistant;

  const [step, setStep] = useState<Step>("capture");
  const [source, setSource] = useState<Source>("text");
  const [transcribing, setTranscribing] = useState(false);
  const [text, setText] = useState("");
  /** The analysed photo and its object URL: kept across a failure so it can be sent again. */
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Bumped on every reset so a response that arrives after the dialog closed is ignored.
  const runRef = useRef(0);
  // Groups created in this session, so a retry after a failure does not create them twice.
  const createdGroupsRef = useRef(new Map<string, string>());

  // Revoke the photo's object URL once it is replaced or the dialog unmounts.
  useEffect(() => {
    if (!sourceUrl) return;
    return () => URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  /** Everything gone: the dialog closed. */
  const reset = () => {
    setStep("capture");
    setText("");
    setSourceFile(null);
    setSourceUrl(null);
    setTranscript(null);
    setSummary("");
    setCandidates([]);
  };

  /** Back to capture after a failure or Retour: the pasted text and the chosen photo stay. */
  const goBack = () => {
    setStep("capture");
    setTranscript(null);
    setSummary("");
    setCandidates([]);
  };

  useEffect(() => {
    if (open) return;
    runRef.current += 1;
    createdGroupsRef.current = new Map();
    reset();
  }, [open]);

  const dropPhoto = () => {
    setSourceFile(null);
    setSourceUrl(null);
  };

  /** A title in the user's language for a failed call; server messages are English. */
  const errorTitle = (err: unknown, fallback: string) => {
    const name = (err as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") return ta.timeout;
    if (/not configured/i.test(errorMessage(err))) return ta.notConfigured;
    return fallback;
  };

  const analyze = async (
    input: { file?: File; text?: string },
    from: Source,
    opts: { keepTranscript?: boolean } = {}
  ) => {
    const run = runRef.current;
    setSource(from);
    setTranscribing(from === "audio" && !opts.keepTranscript);
    setStep("analyzing");
    // Only a photo pins a thumbnail above the review; a stale one would mislabel a text run.
    if (from !== "image") dropPhoto();
    try {
      const res = await api.contacts.assistant.extract({ ...input, language });
      if (run !== runRef.current) return;
      // A re-analysis from the corrected transcript returns none; keep the user's text.
      setTranscript(
        (prev) => res.transcript ?? (opts.keepTranscript ? prev : null)
      );
      setSummary(res.summary);
      setCandidates(
        res.candidates.map((c) => toReview(c, groups, existingEmails))
      );
      setStep("review");
    } catch (err) {
      if (run !== runRef.current) return;
      toast({ title: errorTitle(err, ta.error), variant: "destructive" });
      goBack();
    }
  };

  const onImagePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!looksLikeImage(file)) {
      toast({ title: ta.unsupportedFile, variant: "destructive" });
      return;
    }
    const run = runRef.current;
    setSource("image");
    setTranscribing(false);
    setStep("analyzing");
    let small: File;
    try {
      small = await downscaleImage(file);
    } catch {
      if (run !== runRef.current) return;
      toast({ title: ta.photoUnreadable, variant: "destructive" });
      setStep("capture");
      return;
    }
    if (run !== runRef.current) return;
    if (small.size > MAX_ASSISTANT_UPLOAD_BYTES) {
      toast({ title: ta.photoTooLarge, variant: "destructive" });
      setStep("capture");
      return;
    }
    setSourceFile(small);
    setSourceUrl(URL.createObjectURL(small));
    await analyze({ file: small }, "image");
  };

  const onRecorded = (file: File) => {
    if (!file.type.startsWith("audio/")) {
      toast({ title: ta.unsupportedFile, variant: "destructive" });
      return;
    }
    void analyze({ file }, "audio");
  };

  const onAnalyzeText = () => {
    const value = text.trim();
    if (value) void analyze({ text: value }, "text");
  };

  const reanalyze = () => {
    const value = (transcript ?? "").trim();
    if (value) void analyze({ text: value }, source, { keepTranscript: true });
  };

  const patch = (id: string, fn: (c: ReviewCandidate) => ReviewCandidate) =>
    setCandidates((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));

  const setField = (id: string, key: FieldKey, value: string) =>
    patch(id, (c) => {
      const fields = { ...c.fields, [key]: value };
      if (key !== "email") return { ...c, fields };
      const existing = existingEmails.has(value.trim().toLowerCase());
      const wasOk = !c.existing && isValidEmail(c.fields.email);
      const nowOk = !existing && isValidEmail(value);
      // A candidate that could not be ticked before gets ticked once its email is fixed.
      const selected = existing ? false : !wasOk && nowOk ? true : c.selected;
      return { ...c, fields, existing, selected, createError: null };
    });

  const toggleGroup = (id: string, groupId: string) =>
    patch(id, (c) => ({
      ...c,
      groupIds: c.groupIds.includes(groupId)
        ? c.groupIds.filter((g) => g !== groupId)
        : [...c.groupIds, groupId]
    }));

  const toggleNewGroup = (id: string, name: string) =>
    patch(id, (c) => ({
      ...c,
      newGroupNames: c.newGroupNames.includes(name)
        ? c.newGroupNames.filter((n) => n !== name)
        : [...c.newGroupNames, name]
    }));

  const selectedEmails = useMemo(
    () =>
      candidates
        .filter((c) => c.selected)
        .map((c) => ({ id: c.id, email: c.fields.email.trim().toLowerCase() })),
    [candidates]
  );
  const problemsOf = (c: ReviewCandidate) =>
    candidateProblems(
      { email: c.fields.email, existing: c.existing },
      selectedEmails.filter((s) => s.id !== c.id).map((s) => s.email)
    );
  const selectedCount = selectedEmails.length;
  const blocked = candidates.some(
    (c) => c.selected && problemsOf(c).some((p) => p !== "existing")
  );
  const canCreate = selectedCount > 0 && !blocked;

  /** Group ids by lowercase name: the page's groups plus the ones made in this session. */
  const groupIndex = () => {
    const idByName = new Map<string, string>();
    for (const g of groups) idByName.set(g.name.trim().toLowerCase(), g.id);
    for (const [name, id] of createdGroupsRef.current) idByName.set(name, id);
    return idByName;
  };

  const ensureGroup = async (
    raw: string,
    idByName: Map<string, string>
  ): Promise<string | null> => {
    const name = raw.trim();
    if (!name) return null;
    const lower = name.toLowerCase();
    const known = idByName.get(lower);
    if (known) return known;
    const index = groups.length + createdGroupsRef.current.size;
    const group = await api.groups.create({
      name,
      color: AUTO_COLORS[index % AUTO_COLORS.length]
    });
    idByName.set(lower, group.id);
    createdGroupsRef.current.set(lower, group.id);
    return group.id;
  };

  const create = async () => {
    const run = runRef.current;
    setStep("creating");
    try {
      const selected = candidates.filter((c) => c.selected);
      const idByName = groupIndex();
      const items: CreateContactRequest[] = [];
      for (const c of selected) {
        const ids = new Set(c.groupIds);
        for (const raw of c.newGroupNames) {
          const id = await ensureGroup(raw, idByName);
          if (id) ids.add(id);
        }
        items.push(toCreatePayload(toCandidate(c), [...ids]));
      }

      const res = await api.contacts.assistant.create(items);

      const createdByEmail = new Map(res.created.map((x) => [x.emailLower, x]));
      const skipped = new Set(res.existing.map((e) => e.toLowerCase()));
      const failed = new Map(
        res.errors.map((e) => [e.email.toLowerCase(), e.reason])
      );
      if (run === runRef.current) {
        setCandidates((prev) =>
          prev.map((c) => {
            const lower = c.fields.email.trim().toLowerCase();
            const made = createdByEmail.get(lower);
            if (made) {
              return {
                ...c,
                selected: false,
                existing: true,
                createError: null,
                existingContact: {
                  firstName: made.firstName,
                  lastName: made.lastName,
                  status: made.status,
                  groups: made.groups ?? []
                },
                // Its groups are set; the add-to-groups button has nothing left to do.
                groupsAdded: true
              };
            }
            if (skipped.has(lower)) {
              return {
                ...c,
                selected: false,
                existing: true,
                createError: null
              };
            }
            const reason = failed.get(lower);
            return reason ? { ...c, createError: reason } : c;
          })
        );
      }

      const parts = [`${res.created.length} ${ta.created}`];
      if (res.existing.length > 0) {
        parts.push(`${res.existing.length} ${ta.alreadyPresent}`);
      }
      toast({ title: parts.join(", ") });
      if (res.errors.length > 0) {
        toast({ title: res.errors[0].reason, variant: "destructive" });
      }
      await onCreated();
      if (res.errors.length === 0) {
        onOpenChange(false);
        return;
      }
      if (run === runRef.current) setStep("review");
    } catch (err) {
      toast({
        title: errorTitle(err, errorMessage(err)),
        variant: "destructive"
      });
      if (run === runRef.current) setStep("review");
    }
  };

  /** Adds the ticked groups to a contact that already exists, instead of re-creating it. */
  const addToGroups = async (c: ReviewCandidate) => {
    const ex = c.existingContact;
    if (!ex) return;
    patch(c.id, (x) => ({ ...x, groupsBusy: true }));
    try {
      const idByName = groupIndex();
      const ids = new Set([...ex.groups, ...c.groupIds]);
      for (const raw of c.newGroupNames) {
        const id = await ensureGroup(raw, idByName);
        if (id) ids.add(id);
      }
      await api.contacts.update(c.fields.email.trim().toLowerCase(), {
        groups: [...ids]
      });
      toast({ title: ta.addedToGroups });
      patch(c.id, (x) => ({
        ...x,
        groupsBusy: false,
        groupsAdded: true,
        existingContact: x.existingContact
          ? { ...x.existingContact, groups: [...ids] }
          : null
      }));
      await onCreated();
    } catch (err) {
      toast({
        title: errorTitle(err, errorMessage(err)),
        variant: "destructive"
      });
      patch(c.id, (x) => ({ ...x, groupsBusy: false }));
    }
  };

  const creating = step === "creating";
  const inReview = step === "review" || creating;
  const title = inReview ? ta.reviewTitle : ta.title;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape or an overlay tap must not drop the result of a create still in flight.
        if (!next && creating) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="pr-8">{title}</DialogTitle>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {step === "capture" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{ta.intro}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Tile
                  icon={Camera}
                  label={ta.takePhoto}
                  onClick={() => cameraRef.current?.click()}
                />
                <Tile
                  icon={ImageIcon}
                  label={ta.choosePhoto}
                  onClick={() => galleryRef.current?.click()}
                />
                <div className={VOICE_TILE}>
                  <VoiceCapture
                    variant="button"
                    maxSeconds={MAX_ASSISTANT_VOICE_SECONDS}
                    onRecorded={onRecorded}
                  />
                </div>
              </div>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onImagePicked(e)}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onImagePicked(e)}
              />
              {sourceFile && sourceUrl ? (
                <div className="flex items-center gap-3 rounded-xl border p-2">
                  <img
                    src={sourceUrl}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {sourceFile.name}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => void analyze({ file: sourceFile }, "image")}
                  >
                    <Sparkles />
                    {ta.analyze}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={dropPhoto}
                    aria-label={ta.cancel}
                  >
                    <X />
                  </Button>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>{ta.pasteText}</Label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={ta.textPlaceholder}
                  maxLength={MAX_ASSISTANT_TEXT_CHARS}
                  rows={4}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={onAnalyzeText}
                    disabled={!text.trim()}
                    className="h-10 gradient-terracotta text-white hover:opacity-90"
                  >
                    <Sparkles />
                    {ta.analyze}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {step === "analyzing" ? (
            <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
              {sourceUrl ? (
                <img
                  src={sourceUrl}
                  alt=""
                  className="max-h-32 rounded-lg object-contain"
                  onError={() => setSourceUrl(null)}
                />
              ) : null}
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">
                {transcribing ? t.voiceCapture.transcribing : ta.analyzing}
              </p>
              {transcribing ? (
                <p className="text-xs text-muted-foreground">{ta.analyzing}</p>
              ) : null}
            </div>
          ) : null}

          {inReview ? (
            <div className="space-y-4">
              {sourceUrl ? (
                <div className="sticky top-0 z-10 space-y-1 bg-background pb-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {ta.sourcePhoto}
                  </p>
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-fit"
                  >
                    <img
                      src={sourceUrl}
                      alt={ta.sourcePhoto}
                      className="max-h-40 rounded-lg border object-contain"
                      onError={() => setSourceUrl(null)}
                    />
                  </a>
                </div>
              ) : null}
              {transcript !== null ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {ta.transcript}
                  </Label>
                  <Textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    maxLength={MAX_ASSISTANT_TEXT_CHARS}
                    rows={3}
                    disabled={creating}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {ta.editTranscriptHint}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={reanalyze}
                      disabled={creating || !transcript.trim()}
                    >
                      <RotateCcw />
                      {ta.reanalyze}
                    </Button>
                  </div>
                </div>
              ) : null}
              {summary ? (
                <p className="text-sm text-muted-foreground">{summary}</p>
              ) : null}
              <p className="text-sm font-medium">
                {candidates.length} {ta.found}
              </p>
              {candidates.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    {ta.noneFound}
                  </p>
                  <Button variant="outline" onClick={goBack} className="h-10">
                    <RotateCcw />
                    {ta.retake}
                  </Button>
                </div>
              ) : (
                candidates.map((c) => (
                  <CandidateCard
                    key={c.id}
                    c={c}
                    problems={problemsOf(c)}
                    groups={groups}
                    disabled={creating}
                    onField={(key, value) => setField(c.id, key, value)}
                    onSelect={(selected) =>
                      patch(c.id, (x) => ({ ...x, selected }))
                    }
                    onToggleMore={() =>
                      patch(c.id, (x) => ({ ...x, showMore: !x.showMore }))
                    }
                    onToggleGroup={(groupId) => toggleGroup(c.id, groupId)}
                    onToggleNewGroup={(name) => toggleNewGroup(c.id, name)}
                    onAddToGroups={() => void addToGroups(c)}
                  />
                ))
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
          {inReview ? (
            <Button
              variant="outline"
              onClick={goBack}
              disabled={creating}
              className="h-10 sm:mr-auto"
            >
              <ArrowLeft />
              {ta.back}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
            className="h-10"
          >
            {ta.cancel}
          </Button>
          {inReview && candidates.length > 0 ? (
            <Button
              onClick={() => void create()}
              disabled={!canCreate || creating}
              className="h-10 gradient-terracotta text-white hover:opacity-90"
            >
              {creating ? <Loader2 className="animate-spin" /> : <UserPlus />}
              {creating
                ? ta.creating
                : `${ta.create} ${selectedCount} ${ta.contactsUnit}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
