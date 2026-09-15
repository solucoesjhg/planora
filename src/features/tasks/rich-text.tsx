"use client";

import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The editor (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * It writes HTML, and HTML from a browser is a proposal: the server sanitizes
 * it against an allowlist before it is stored. Saving happens when the field
 * loses focus, because a task body is written in sittings, not keystrokes.
 */

export type RichTextProps = {
  readonly value: string;
  readonly placeholder?: string;
  readonly editable?: boolean;
  readonly minHeight?: string;
  readonly onSave: (html: string) => void | Promise<void>;
  /** Images dropped into the body are uploaded, then referenced by URL. */
  readonly onUploadImage?: (file: File) => Promise<string | null>;
  readonly toolbar?: boolean;
};

export function RichText({
  value,
  placeholder = "Escreva aqui…",
  editable = true,
  minHeight = "8rem",
  onSave,
  onUploadImage,
  toolbar = true,
}: RichTextProps) {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const latest = useRef(value);
  // Tiptap keeps the callbacks it was created with; state read inside them can
  // be a render old. The ref is the truth, the state is the label.
  const unsaved = useRef(false);
  const saving = useRef<Promise<void> | null>(null);

  const editor = useEditor({
    // The server renders this page first; the editor mounts in the browser.
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: false }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "pln-prose focus:outline-none",
        style: `min-height:${minHeight}`,
      },
      handlePaste: (_view, event) => uploadFrom(event.clipboardData?.files),
      handleDrop: (_view, event) =>
        uploadFrom((event as DragEvent).dataTransfer?.files),
    },
    onUpdate: ({ editor: instance }) => {
      latest.current = instance.getHTML();
      unsaved.current = true;
      setDirty(true);
      setSaved(false);
    },
    onBlur: () => void save(),
  });

  function uploadFrom(files: FileList | undefined): boolean {
    const images = [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0 || !onUploadImage || !editor) return false;

    void (async () => {
      for (const file of images) {
        const url = await onUploadImage(file);
        if (url) editor.chain().focus().setImage({ src: url }).run();
      }
      latest.current = editor.getHTML();
      await save();
    })();

    // Handled here: the default would insert the file's local blob URL, which
    // stops working the moment the tab does.
    return true;
  }

  async function save(): Promise<void> {
    if (!unsaved.current) return;
    // One write at a time: a blur while a save is in flight waits for it.
    if (saving.current) {
      await saving.current;
      if (!unsaved.current) return;
    }

    unsaved.current = false;
    const write = Promise.resolve(onSave(latest.current));
    saving.current = write;
    try {
      await write;
    } catch {
      unsaved.current = true;
      throw new Error("save failed");
    } finally {
      saving.current = null;
    }
    setDirty(false);
    setSaved(true);
  }

  // The server is the source of truth: a value that changed elsewhere wins,
  // unless this editor is holding something unsaved.
  useEffect(() => {
    if (!editor || dirty || unsaved.current) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
      latest.current = value;
    }
  }, [editor, value, dirty]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!editor) {
    return (
      <div
        className="rounded-card border border-line bg-card p-3 text-[13px] text-subtle"
        style={{ minHeight }}
      >
        Carregando o editor…
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-card border border-line bg-card transition-colors",
        "focus-within:border-line-strong",
      )}
    >
      {toolbar && editable ? <Toolbar editor={editor} /> : null}

      <div className="px-3 py-2.5">
        <EditorContent editor={editor} />
      </div>

      <div className="flex h-6 items-center justify-end px-3 text-[11px] text-subtle">
        {dirty ? "não salvo" : saved ? "salvo" : ""}
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-hairline px-2 py-1.5">
      <ToolbarButton
        label="Negrito"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={14} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Itálico"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={14} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Riscado"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={14} aria-hidden />
      </ToolbarButton>

      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />

      <ToolbarButton
        label="Título"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={14} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Lista"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Lista numerada"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={14} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Citação"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={14} aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Código"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code size={14} aria-hidden />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // Blur would save on every toolbar click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "rounded-control p-1.5 text-muted transition-colors",
        "hover:bg-card-hover hover:text-primary",
        active && "bg-card-hover text-primary",
      )}
    >
      {children}
    </button>
  );
}
