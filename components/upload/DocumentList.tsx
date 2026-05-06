"use client";

import { useRef, useState } from "react";

export interface ProcessedDoc {
  document_id: string;
  name: string;
  role: "primary" | "supporting";
  document_type: string;
  text: string;
  pages: number | null;
  drawing_type?: string | null;
  subject_name?: string | null;
}

export interface UploadedDoc {
  id: string;
  file: File;
  processedDoc?: ProcessedDoc | null;
  processing?: boolean;
  error?: string | null;
}

interface Props {
  docs: UploadedDoc[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

const MAX_DOCS = 6;
const MAX_BYTES = 50 * 1024 * 1024;

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function DocStatusIcon({ doc }: { doc: UploadedDoc }) {
  if (doc.processing) {
    return <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-amber-400/60 border-t-transparent animate-spin shrink-0" />;
  }
  if (doc.error) {
    return (
      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    );
  }
  if (doc.processedDoc) {
    return (
      <svg className="w-3.5 h-3.5 text-green-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
      </svg>
    );
  }
  return null;
}

function DocSubline({ doc }: { doc: UploadedDoc }) {
  if (doc.processing) return <span className="text-amber-300/80">Processing…</span>;
  if (doc.error) return <span className="text-red-400">{doc.error}</span>;
  if (doc.processedDoc) {
    const p = doc.processedDoc;
    const parts: string[] = [];
    if (p.pages) parts.push(`${p.pages} ${p.pages === 1 ? "page" : "pages"}`);
    if (p.drawing_type && p.drawing_type !== "other") parts.push(p.drawing_type.replace(/_/g, " "));
    if (p.subject_name) parts.push(p.subject_name);
    return <span className="text-green-400/80">{parts.length ? parts.join(" · ") : "Ready"}</span>;
  }
  return null;
}

export function DocumentList({ docs, onAdd, onRemove, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const canAdd = docs.length < MAX_DOCS && !disabled;

  function handleFiles(files: FileList | null) {
    if (!files || !canAdd) return;
    const valid: File[] = [];
    const remaining = MAX_DOCS - docs.length;
    for (let i = 0; i < Math.min(files.length, remaining); i++) {
      const f = files[i];
      const name = f.name.toLowerCase();
      if (!name.endsWith(".pdf") && !name.endsWith(".docx")) continue;
      if (f.size > MAX_BYTES) continue;
      if (docs.some((d) => d.file.name === f.name)) continue;
      valid.push(f);
    }
    if (valid.length > 0) onAdd(valid);
  }

  if (docs.length === 0) {
    return (
      <div
        className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center ${
          dragging ? "border-amber-400 bg-amber-500/5" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
        />
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center">
            <UploadIcon className="w-6 h-6 text-gray-400" />
          </div>
          <div>
            <p className="font-medium text-sm text-white">Add your project documents</p>
            <p className="text-xs text-gray-500 mt-1">PDF or Word · up to {MAX_DOCS} files · 50 MB each</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {docs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10"
          >
            <div className="w-7 h-7 rounded bg-amber-500/15 flex items-center justify-center shrink-0">
              <FileIcon className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white truncate">{doc.file.name}</p>
              <div className="text-[11px] mt-0.5">
                <DocSubline doc={doc} />
              </div>
            </div>
            <DocStatusIcon doc={doc} />
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(doc.id)}
                className="text-gray-600 hover:text-gray-300 shrink-0 ml-1"
                aria-label="Remove"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {canAdd && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            className={`w-full px-3 py-2 rounded-lg border border-dashed transition-colors text-xs text-gray-500 hover:text-white ${
              dragging ? "border-amber-400/60 bg-amber-500/5 text-white" : "border-white/15 hover:border-white/30"
            }`}
          >
            + Add more documents ({docs.length}/{MAX_DOCS})
          </button>
        </>
      )}
    </div>
  );
}
