import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CONTACT_CANDIDATE_FIELDS,
  MAX_ASSISTANT_UPLOAD_BYTES,
  MAX_ASSISTANT_VOICE_SECONDS,
  type ContactCandidate,
  type ContactCandidateField,
  type ContactConfidence
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
  UserPlus
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
    existing: c.existing
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
  "inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-opacity";
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
  textarea = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  invalid?: boolean;
  hint?: string;
  disabled?: boolean;
  textarea?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {textarea ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          disabled={disabled}
        />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={`h-10 ${invalid ? "border-destructive" : ""}`}
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
  onToggleNewGroup
}: CardProps) {
  const { t } = useLanguage();
  const ta = t.contactAssistant;
  const tf = t.contactForm;
  const f = c.fields;

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
    />
  );

  return (
    <div
      className={`space-y-3 rounded-xl border p-3 sm:p-4 ${c.selected ? "" : "bg-muted/30"}`}
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
              <span className="truncate font-medium">{title}</span>
            ) : null}
            <span className={`${PILL} ${CONFIDENCE_CLASSES[c.confidence]}`}>
              {ta.confidence}: {confidenceLabel}
            </span>
            {c.existing ? (
              <span
                className={`${PILL} bg-gray-100 text-gray-700 border-gray-200`}
              >
                {ta.existing}
              </span>
            ) : null}
          </div>
          {c.existing ? (
            <p className="text-xs text-muted-foreground">{ta.existingHint}</p>
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
                  disabled={disabled}
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
                  disabled={disabled}
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
        </div>
      ) : null}
    </div>
  );
}

/**
 * Adds contacts from a photo, a recording or a pasted text.
 *
 * One extract call, then a review step where every field is editable and nothing is created until
 * the user confirms. Candidates the server flagged as existing, or whose email is unreadable,
 * start unticked.
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
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Bumped on every reset so a response that arrives after the dialog closed is ignored.
  const runRef = useRef(0);
  // Groups created in this session, so a retry after a failed contact does not create them twice.
  const createdGroupsRef = useRef(new Map<string, string>());

  // Revoke the thumbnail's object URL once it is replaced or the dialog unmounts.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const backToCapture = () => {
    setStep("capture");
    setText("");
    setPreview(null);
    setTranscript(null);
    setSummary("");
    setCandidates([]);
  };

  useEffect(() => {
    if (open) return;
    runRef.current += 1;
    createdGroupsRef.current = new Map();
    backToCapture();
  }, [open]);

  const analyze = async (
    input: { file?: File; text?: string },
    from: Source
  ) => {
    const run = runRef.current;
    setSource(from);
    setStep("analyzing");
    try {
      const res = await api.contacts.assistant.extract({ ...input, language });
      if (run !== runRef.current) return;
      setTranscript(res.transcript);
      setSummary(res.summary);
      setCandidates(
        res.candidates.map((c) => toReview(c, groups, existingEmails))
      );
      setStep("review");
    } catch (err) {
      if (run !== runRef.current) return;
      const msg = errorMessage(err);
      toast({
        title: /not configured/i.test(msg) ? ta.notConfigured : msg || ta.error,
        variant: "destructive"
      });
      setStep("capture");
    } finally {
      if (run === runRef.current) setPreview(null);
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
    setStep("analyzing");
    const small = await downscaleImage(file);
    if (run !== runRef.current) return;
    if (small.size > MAX_ASSISTANT_UPLOAD_BYTES) {
      toast({ title: ta.photoTooLarge, variant: "destructive" });
      setStep("capture");
      return;
    }
    setPreview(URL.createObjectURL(small));
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
      return { ...c, fields, existing, selected };
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

  const create = async () => {
    const run = runRef.current;
    setStep("creating");
    const idByName = new Map<string, string>();
    for (const g of groups) idByName.set(g.name.trim().toLowerCase(), g.id);
    for (const [name, id] of createdGroupsRef.current) idByName.set(name, id);

    let created = 0;
    let touched = false;
    try {
      const selected = candidates.filter((c) => c.selected);

      const wanted: string[] = [];
      for (const c of selected) {
        for (const raw of c.newGroupNames) {
          const name = raw.trim();
          const lower = name.toLowerCase();
          if (!name || idByName.has(lower)) continue;
          if (wanted.some((w) => w.toLowerCase() === lower)) continue;
          wanted.push(name);
        }
      }
      let colorIndex = groups.length;
      for (const name of wanted) {
        const group = await api.groups.create({
          name,
          color: AUTO_COLORS[colorIndex++ % AUTO_COLORS.length]
        });
        idByName.set(name.toLowerCase(), group.id);
        createdGroupsRef.current.set(name.toLowerCase(), group.id);
        touched = true;
      }

      for (const c of selected) {
        const ids = new Set(c.groupIds);
        for (const raw of c.newGroupNames) {
          const id = idByName.get(raw.trim().toLowerCase());
          if (id) ids.add(id);
        }
        await api.contacts.create(toCreatePayload(toCandidate(c), [...ids]));
        created += 1;
        touched = true;
        // Done: a retry after a later failure must not create it twice.
        patch(c.id, (x) => ({ ...x, selected: false, existing: true }));
      }

      toast({ title: `${created} ${ta.created}` });
      await onCreated();
      onOpenChange(false);
    } catch (err) {
      toast({ title: errorMessage(err), variant: "destructive" });
      if (touched) await onCreated();
      if (run === runRef.current) setStep("review");
    }
  };

  const creating = step === "creating";
  const inReview = step === "review" || creating;
  const title = inReview ? ta.reviewTitle : ta.title;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <div className="space-y-2">
                <Label>{ta.pasteText}</Label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={ta.textPlaceholder}
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
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  className="max-h-32 rounded-lg object-contain"
                  onError={() => setPreview(null)}
                />
              ) : null}
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">
                {source === "audio"
                  ? t.voiceCapture.transcribing
                  : ta.analyzing}
              </p>
              {source === "audio" ? (
                <p className="text-xs text-muted-foreground">{ta.analyzing}</p>
              ) : null}
            </div>
          ) : null}

          {inReview ? (
            <div className="space-y-4">
              {transcript ? (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">
                    {ta.transcript}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{transcript}</p>
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
                  <Button
                    variant="outline"
                    onClick={backToCapture}
                    className="h-10"
                  >
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
              onClick={backToCapture}
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
