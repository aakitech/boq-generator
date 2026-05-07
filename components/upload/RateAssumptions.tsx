"use client";

import { useState } from "react";

export interface RateContext {
  province: string;
  projectType: string;
  accessibility: string;
  labourSource: string;
  marginPct: number;
}

export const PROVINCES = [
  "Lusaka", "Copperbelt", "Southern", "Eastern", "Northern",
  "Western", "Luapula", "North-Western", "Muchinga", "Central",
];

export const PROJECT_TYPES = [
  { val: "building", label: "Building" },
  { val: "civil", label: "Civil works" },
  { val: "water_sanitation", label: "Water & sanitation" },
  { val: "road", label: "Road & pavement" },
  { val: "mep", label: "MEP" },
  { val: "mixed", label: "Mixed" },
];

export const DEFAULT_CONTEXT: RateContext = {
  province: "Lusaka",
  projectType: "building",
  accessibility: "main_road",
  labourSource: "mixed",
  marginPct: 15,
};

interface Props {
  ctx: RateContext;
  onChange: (ctx: RateContext) => void;
  defaultOpen?: boolean;
}

export function RateAssumptions({ ctx, onChange, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [customMargin, setCustomMargin] = useState(false);

  const set = (patch: Partial<RateContext>) => onChange({ ...ctx, ...patch });

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-medium text-gray-400">Pricing assumptions</span>
        <span className="text-xs text-gray-500 flex items-center gap-2">
          <span className="text-gray-500">
            {ctx.province} · {ctx.projectType.replace("_", " ")} · {ctx.marginPct}%
          </span>
          <svg
            className={`w-3.5 h-3.5 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5">
          {/* Province */}
          <div className="space-y-2 pt-3">
            <p className="text-xs font-medium text-white">Province</p>
            <div className="flex flex-wrap gap-1.5">
              {PROVINCES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set({ province: p })}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    ctx.province === p ? "bg-amber-400 text-black" : "bg-white/10 text-gray-300 hover:bg-white/15"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Project type */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-white">Project type</p>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_TYPES.map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => set({ projectType: val })}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    ctx.projectType === val ? "bg-amber-400 text-black" : "bg-white/10 text-gray-300 hover:bg-white/15"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Site access */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-white">Site access</p>
            <div className="flex flex-col gap-1.5">
              {[
                { val: "main_road", label: "Main road" },
                { val: "gravel_road", label: "Gravel / secondary road" },
                { val: "remote", label: "Remote / bush site" },
              ].map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => set({ accessibility: val })}
                  className={`flex items-center gap-2 px-3 py-2 rounded text-left transition-colors ${
                    ctx.accessibility === val
                      ? "bg-amber-400/15 border border-amber-400/40"
                      : "bg-white/5 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${ctx.accessibility === val ? "border-amber-400 bg-amber-400" : "border-gray-500"}`} />
                  <span className="text-xs text-white">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Labour source */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-white">Labour source</p>
            <div className="flex flex-col gap-1.5">
              {[
                { val: "local_unskilled", label: "Mostly local unskilled" },
                { val: "mixed", label: "Mix of skilled & unskilled" },
                { val: "imported_skilled", label: "Imported / specialist trades" },
              ].map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => set({ labourSource: val })}
                  className={`flex items-center gap-2 px-3 py-2 rounded text-left transition-colors ${
                    ctx.labourSource === val
                      ? "bg-amber-400/15 border border-amber-400/40"
                      : "bg-white/5 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${ctx.labourSource === val ? "border-amber-400 bg-amber-400" : "border-gray-500"}`} />
                  <span className="text-xs text-white">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Margin */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-white">Overhead & profit margin</p>
            <div className="flex flex-wrap gap-1.5">
              {[10, 15, 20].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => { set({ marginPct: pct }); setCustomMargin(false); }}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    ctx.marginPct === pct && !customMargin ? "bg-amber-400 text-black" : "bg-white/10 text-gray-300 hover:bg-white/15"
                  }`}
                >
                  {pct}%
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomMargin(true)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  customMargin ? "bg-amber-400 text-black" : "bg-white/10 text-gray-300 hover:bg-white/15"
                }`}
              >
                Custom
              </button>
            </div>
            {customMargin && (
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={50} value={ctx.marginPct}
                  onChange={(e) => set({ marginPct: Math.min(50, Math.max(1, Number(e.target.value) || 15)) })}
                  className="w-16 px-2 py-1.5 rounded bg-white/10 border border-white/20 text-white text-xs text-center focus:outline-none focus:border-amber-400/60"
                />
                <span className="text-xs text-gray-400">%</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
