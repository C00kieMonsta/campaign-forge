import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import { AlignCenter, AlignLeft, AlignRight, Bold, Image as ImageIcon, Italic, Link2, List, ListOrdered, Paperclip } from "lucide-react";
import { api } from "@/lib/api";

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("width") || el.style.width || null,
        renderHTML: (attrs) => {
          if (!attrs.width) return {};
          return { width: attrs.width, style: `width: ${attrs.width}` };
        },
      },
    };
  },
});

const IMAGE_WIDTHS = [
  { label: "25%", value: "25%" },
  { label: "50%", value: "50%" },
  { label: "75%", value: "75%" },
  { label: "100%", value: "100%" },
] as const;

export interface TiptapEditorHandle {
  insertContent: (text: string) => void;
  setContent: (html: string) => void;
}

interface Props {
  content: string;
  onChange: (html: string) => void;
  readonly?: boolean;
  onAttachment?: (file: File) => void;
}

const TiptapEditor = forwardRef<TiptapEditorHandle, Props>(({ content, onChange, readonly = false, onAttachment }, ref) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      ResizableImage.configure({ inline: false }),
    ],
    content,
    editable: !readonly,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useImperativeHandle(ref, () => ({
    insertContent: (text) => {
      editor?.commands.focus();
      editor?.commands.insertContent(text);
    },
    setContent: (html) => {
      editor?.commands.setContent(html);
      onChange(html);
    },
  }));

  const insertImage = async (file: File) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      const { url } = await api.campaigns.upload(file);
      editor?.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      console.log(JSON.stringify({ event: "TiptapEditor:uploadError", error: String(err) }));
    } finally {
      uploadingRef.current = false;
    }
  };

  const setImageWidth = useCallback((width: string) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    editor.chain().focus().updateAttributes("image", { width }).setNodeSelection(from === to ? from : from).run();
  }, [editor]);

  const setLink = () => {
    const previous = editor?.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL du lien", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor?.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  if (!editor) {
    return <div className="flex-1 border border-border rounded-lg bg-muted/20 animate-pulse" />;
  }

  const isImageSelected = editor.isActive("image");
  const currentWidth = isImageSelected ? (editor.getAttributes("image").width as string | null) : null;

  return (
    <div className="border border-border rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
      {!readonly && <div className="flex flex-wrap gap-0.5 p-1.5 border-b border-border bg-muted/30 shrink-0">
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Gras"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italique"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Separator />

        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Titre 1"
        >
          <span className="text-xs font-bold">H1</span>
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Titre 2"
        >
          <span className="text-xs font-bold">H2</span>
        </ToolbarBtn>

        <Separator />

        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Liste à puces"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Liste numérotée"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Separator />

        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="Aligner à gauche"
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="Centrer"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="Aligner à droite"
        >
          <AlignRight className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Separator />

        <ToolbarBtn onClick={setLink} active={editor.isActive("link")} title="Ajouter un lien">
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => fileInputRef.current?.click()} title="Insérer une image">
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) insertImage(file);
            e.target.value = "";
          }}
        />
        {onAttachment && (
          <>
            <ToolbarBtn onClick={() => attachInputRef.current?.click()} title="Joindre un fichier">
              <Paperclip className="h-3.5 w-3.5" />
            </ToolbarBtn>
            <input
              ref={attachInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAttachment(file);
                e.target.value = "";
              }}
            />
          </>
        )}

        <Separator />

        <label
          title="Couleur du texte"
          className="relative flex items-center justify-center w-7 h-7 rounded cursor-pointer hover:bg-muted transition-colors overflow-hidden"
        >
          <span
            className="text-xs font-bold underline"
            style={{ color: (editor.getAttributes("textStyle").color as string) || "currentColor" }}
          >
            A
          </span>
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            value={(editor.getAttributes("textStyle").color as string) || "#333333"}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>

        {isImageSelected && (
          <>
            <Separator />
            {IMAGE_WIDTHS.map((w) => (
              <ToolbarBtn
                key={w.value}
                onClick={() => setImageWidth(w.value)}
                active={currentWidth === w.value}
                title={`Largeur ${w.label}`}
              >
                <span className="text-[10px] font-semibold">{w.label}</span>
              </ToolbarBtn>
            ))}
          </>
        )}
      </div>}

      <div className={`flex-1 overflow-auto p-4 min-h-0 ${readonly ? "bg-muted/20" : ""}`}>
        <EditorContent editor={editor} className="tiptap-editor h-full" />
      </div>
    </div>
  );
});

TiptapEditor.displayName = "TiptapEditor";

function ToolbarBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center w-7 h-7 rounded text-sm transition-colors ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="w-px bg-border mx-0.5 self-stretch" />;
}

export default TiptapEditor;
