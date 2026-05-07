# Design System — BOQ Generator

## Product Context
- **What this is:** AI-powered Bill of Quantities generator. QSs upload construction documents and get a structured, priced BOQ in under a minute.
- **Who it's for:** Quantity Surveyors and QS firms across Southern Africa (Zambia primary, expanding to Zimbabwe, Malawi, etc.)
- **Space/industry:** Construction procurement and cost management software
- **Project type:** Web app — data-dense, document-centric, professional tool

## Memorable Thing
> "This is precision tooling for number people — not construction software, not a startup, not a web app. A precision instrument."

Every design decision serves this. The BOQ data is the hero. Everything else steps back.

## Aesthetic Direction
- **Direction:** Industrial / Utilitarian
- **Decoration level:** Minimal — typography and whitespace carry everything. No blobs, no gradients, no icons in colored circles.
- **Mood:** Dark surfaces, data-dense, zero decoration. Closer to a Bloomberg terminal or Linear than to Procore. The product should feel like it was built for someone who cares about numbers.
- **What we're deliberately NOT:** The category default (orange, hard-hat photography, chunky enterprise UI). That's for site managers. QSs live in Excel.
- **Reference products:** Linear (density + restraint), Vercel (dark + confident), Bloomberg (data as aesthetic)

## Typography
- **Display / Hero:** Instrument Serif — authority and warmth in the same stroke. Used only for large headings (page titles, screen headings, BOQ project name). Not for body text, not for UI.
- **Body / UI:** Geist — designed for data interfaces, optically precise, excellent tabular-nums support for ZMW amounts.
- **Data / Tables:** Geist Mono — numbers align, columns read cleanly. All monetary amounts, quantities, and measurements use this with `font-variant-numeric: tabular-nums`.
- **Loading:** Google Fonts CDN — `https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap`

### Type Scale
| Token | Size | Weight | Font | Usage |
|-------|------|--------|------|-------|
| `display` | 48–64px | 400 | Instrument Serif | Landing page hero |
| `heading-xl` | 32–40px | 400 | Instrument Serif | Page headings |
| `heading-lg` | 22–28px | 400 | Instrument Serif | Screen titles, BOQ project name |
| `heading-sm` | 15–17px | 500 | Geist | Section headings, card titles |
| `body` | 15px | 400 | Geist | Paragraphs, descriptions |
| `ui` | 13px | 400–500 | Geist | Labels, buttons, nav items |
| `caption` | 11–12px | 400–500 | Geist | Metadata, timestamps, helper text |
| `overline` | 10–11px | 600 | Geist | Table headers, section labels (uppercase + letter-spacing) |
| `data` | 12–13px | 400–500 | Geist Mono | Amounts, quantities, measurements |
| `data-total` | 15–16px | 600 | Geist Mono | Grand totals, summary figures |

## Color
- **Approach:** Restrained — one accent color, used sparingly. Color is meaningful, not decorative.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#0a0a0a` | Page background (near-black, not pure black) |
| `--surface` | `#111111` | Card surfaces, panels |
| `--surface-2` | `#1a1a1a` | Input backgrounds, nested surfaces |
| `--border` | `#262626` | All borders |
| `--border-subtle` | `#1c1c1c` | Table row dividers, subtle separators |
| `--text` | `#f5f5f5` | Primary text |
| `--text-muted` | `#737373` | Secondary text, labels, metadata |
| `--text-faint` | `#404040` | Disabled text, placeholders, overlines |
| `--accent` | `#f59e0b` | CTAs, active states, progress bars, the amber thread |
| `--accent-hover` | `#fbbf24` | Accent on hover |
| `--accent-dim` | `rgba(245,158,11,0.10)` | Accent backgrounds (icon wells, alert backgrounds) |
| `--success` | `#22c55e` | Completed states, success badges |
| `--error` | `#ef4444` | Errors, delete actions |
| `--warning` | `#f59e0b` | Same as accent — warnings use the amber |

- **Dark mode:** This is a dark-first product. No light mode planned.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — tight enough to feel professional, not cramped

| Token | Value | Usage |
|-------|-------|-------|
| `2xs` | 4px | Icon gaps, tight inline spacing |
| `xs` | 8px | Within-component padding |
| `sm` | 12px | Item padding, list gaps |
| `md` | 16px | Card padding, form row gaps |
| `lg` | 24px | Section internal spacing |
| `xl` | 32px | Between major sections |
| `2xl` | 48px | Hero padding, page-level gaps |
| `3xl` | 64–96px | Top-level section separators |

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment.
- **Max content width:** 960px for most content; 480px for single-column forms/upload screens.
- **Upload zone metaphor:** Document tray, not cloud upload. Files sit in a structured list — filename, status, remove button. No drag-and-drop playground aesthetic.
- **Tables:** Look like tables. Clean column alignment, monospace numbers, subtle row separators. The BOQ table is the product's most important UI.

### Border Radius
| Element | Radius |
|---------|--------|
| Buttons | 6px |
| Cards / Panels | 8px |
| Screens / Modals | 10px |
| Inputs | 6px |
| Badges | 4px |
| Avatars | 50% |
| Status dots | 50% |

## Motion
- **Approach:** Minimal-functional — only transitions that reduce cognitive load.
- **No entrance animations.** Content appears, it doesn't fly in.
- **Active elements:** Spinners (job running, file extracting, AI generating) are the only animated elements. They signal work happening, nothing else.
- **Easing:** `ease-out` for entrances, `ease-in` for exits, `ease-in-out` for state transitions
- **Duration:** 150–200ms for state changes (hover, focus), 250ms for panel open/close

## Background Jobs UX

This section documents the agreed interaction design for Inngest background jobs.

### Generation / Rate-fill
- After clicking "Generate BOQ →", the user is immediately navigated to `/generating?boq_id=...`
- The `/generating` page shows: progress steps, a "Go to dashboard →" link, and the message "You can navigate away — we'll notify you when it's done."
- The page polls the BOQ `processing_status` field every 2 seconds. When `completed`, it redirects to `/boq/[id]`.

### Dashboard while job runs
- The in-progress BOQ row is amber-tinted (`border-color: rgba(245,158,11,0.25)`) with a "⧗ Generating..." label inline.
- The nav shows a "1 running" pill with a spinning indicator.
- When the job completes: the row flips to normal, showing the ZMW amount. A toast notification appears.

### Completion notifications
- **In-app:** Toast in the bottom-right corner: "Your BOQ is ready — view it →" (dismisses after 6s)
- **Email:** Sent via Resend when the Inngest job marks `processing_status: "completed"`. Subject: "Your BOQ is ready — [project name]".
- No modal on completion.

### Extraction (upload page)
- Stays synchronous/blocking — extraction is fast (5–15s per file) and users need the feedback to know the file was read correctly before clicking Generate.
- Per-file spinner inline in the document list. Other files can still be added while one is extracting.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-07 | Industrial/Utilitarian aesthetic | QSs are number people, not site workers. Precision instrument aesthetic over construction-SaaS defaults. |
| 2026-05-07 | Instrument Serif for headings | No construction software uses this. Authority + warmth. Memorable. |
| 2026-05-07 | Zero decoration | The BOQ data is the hero. Decoration would compete. |
| 2026-05-07 | Amber (#f59e0b) as sole accent | Already in codebase, already associated with the brand. Warm thread in a cold system. |
| 2026-05-07 | Geist Mono for all amounts | Tabular-nums alignment is non-negotiable for BOQ tables. |
| 2026-05-07 | Document tray upload metaphor | Matches QS mental model (physical tender documents in a tray), not tech-startup cloud upload. |
| 2026-05-07 | Extraction stays blocking | Fast enough (5-15s). Interactive feedback on the upload page matters more than navigability. |
| 2026-05-07 | Toast + email on job completion | Toast for in-app users, email for users who closed the tab. Rate-fill can take 5 min. |
