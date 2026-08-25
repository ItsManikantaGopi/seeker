"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Explanation } from "@/lib/seeker/types";

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function Panel({
  title, subtitle, children, actions, tone = "default", dense = false, id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "sunken" | "accent";
  dense?: boolean;
  id?: string;
}) {
  const bg = tone === "sunken" ? "bg-sunken" : tone === "accent" ? "bg-accent-soft" : "bg-raised";
  return (
    <section id={id} className={`rounded-xl border border-edge ${bg} shadow-[var(--shadow)]`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={dense ? "p-3" : "p-4"}>{children}</div>
    </section>
  );
}

export function Grid({ cols = 2, children, gap = 4 }: { cols?: 1 | 2 | 3 | 4; children: ReactNode; gap?: 3 | 4 | 6 }) {
  const map = {
    1: "grid-cols-1",
    2: "grid-cols-1 lg:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
    4: "grid-cols-2 xl:grid-cols-4",
  } as const;
  const gapClass = gap === 3 ? "gap-3" : gap === 6 ? "gap-6" : "gap-4";
  return <div className={`grid ${map[cols]} ${gapClass}`}>{children}</div>;
}

export function Stack({ children, gap = 4 }: { children: ReactNode; gap?: 2 | 3 | 4 | 6 }) {
  const map = { 2: "space-y-2", 3: "space-y-3", 4: "space-y-4", 6: "space-y-6" } as const;
  return <div className={map[gap]}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Card Primitives
// ---------------------------------------------------------------------------

export function Card({
  children, tone = "raised", padding = "md", className = "", interactive = false, style,
}: {
  children: ReactNode;
  tone?: "raised" | "sunken" | "accent";
  padding?: "none" | "sm" | "md" | "lg";
  className?: string;
  interactive?: boolean;
  style?: React.CSSProperties;
}) {
  const bg = tone === "sunken" ? "bg-sunken" : tone === "accent" ? "bg-accent-soft" : "bg-raised";
  const p = { none: "p-0", sm: "p-3", md: "p-5", lg: "p-8" }[padding];
  const interactiveStyles = interactive ? "transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-edge-strong" : "";
  return (
    <div className={`rounded-2xl border border-edge ${bg} shadow-[var(--shadow)] ${p} ${interactiveStyles} ${className}`} style={style}>
      {children}
    </div>
  );
}

export function CardGrid({
  children, cols = 3, gap = "md",
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
}) {
  const map = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  } as const;
  const gapMap = { sm: "gap-3", md: "gap-5", lg: "gap-8" };
  return <div className={`grid ${map[cols]} ${gapMap[gap]}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Text bits
// ---------------------------------------------------------------------------

export function Mono({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "muted" }) {
  const color = tone === "accent" ? "text-accent-text" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <code className={`rounded border border-edge bg-code px-1.5 py-0.5 font-mono text-[12px] ${color}`}>
      {children}
    </code>
  );
}

export function Badge({
  children, tone = "neutral", title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "ok" | "warn" | "bad" | "info";
  title?: string;
}) {
  const map = {
    neutral: "bg-sunken text-muted border-edge",
    accent: "bg-accent-soft text-accent-text border-transparent",
    ok: "bg-ok-soft text-ok border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    bad: "bg-bad-soft text-bad border-transparent",
    info: "bg-info-soft text-info border-transparent",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[11px] leading-4 ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function Callout({
  tone = "info", title, children,
}: {
  tone?: "info" | "warn" | "ok" | "bad" | "accent";
  title?: ReactNode;
  children: ReactNode;
}) {
  const map = {
    info: "border-l-[var(--info)] bg-info-soft",
    warn: "border-l-[var(--warn)] bg-warn-soft",
    ok: "border-l-[var(--ok)] bg-ok-soft",
    bad: "border-l-[var(--bad)] bg-bad-soft",
    accent: "border-l-[var(--accent)] bg-accent-soft",
  } as const;
  return (
    <div className={`rounded-r-lg border border-edge border-l-[3px] px-3 py-2.5 text-[12.5px] leading-relaxed ${map[tone]}`}>
      {title && <div className="mb-1 font-semibold text-ink">{title}</div>}
      <div className="text-muted [&_strong]:text-ink [&_code]:font-mono">{children}</div>
    </div>
  );
}

export function Stat({
  label, value, unit, tone = "default", hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "default" | "ok" | "warn" | "bad" | "accent";
  hint?: string;
}) {
  const color = {
    default: "text-ink", ok: "text-ok", warn: "text-warn", bad: "text-bad", accent: "text-accent-text",
  }[tone];
  return (
    <div className="rounded-lg border border-edge bg-raised px-3 py-2" title={hint}>
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={`mt-0.5 font-mono text-[17px] font-semibold leading-tight tabular-nums ${color}`}>
        {value}
        {unit && <span className="ml-1 text-[11px] font-normal text-faint">{unit}</span>}
      </div>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="flex items-baseline gap-1.5 text-[11.5px] font-medium text-muted" title={hint}>
      {children}
    </span>
  );
}

export function Slider({
  label, value, min, max, step = 1, onChange, format, hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2">
        <Label hint={hint}>{label}</Label>
        <span className="font-mono text-[12px] tabular-nums text-accent-text">
          {format ? format(value) : value}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Toggle({
  label, checked, onChange, hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted" title={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors ${
          checked ? "border-transparent bg-[var(--accent)]" : "border-edge-strong bg-sunken"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[12px] w-[12px] rounded-full bg-raised transition-all ${
            checked ? "left-[17px]" : "left-[2px]"
          }`}
        />
      </button>
      <span className="select-none">{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, label,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div>
      {label && <div className="mb-1"><Label>{label}</Label></div>}
      <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-edge bg-sunken p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
              value === option.value
                ? "bg-raised text-ink shadow-[var(--shadow)]"
                : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TextInput({
  label, value, onChange, placeholder, mono = true, hint, onEnter,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: string;
  onEnter?: () => void;
}) {
  const id = useId();
  return (
    <div>
      {label && <label htmlFor={id} className="mb-1 block"><Label hint={hint}>{label}</Label></label>}
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        className={`w-full rounded-lg border border-edge bg-raised px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-[var(--accent)] ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

export function Select<T extends string>({
  label, value, onChange, options, hint,
}: {
  label?: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      {label && <label htmlFor={id} className="mb-1 block"><Label hint={hint}>{label}</Label></label>}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-lg border border-edge bg-raised px-2.5 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Button({
  children, onClick, tone = "default", size = "md", disabled, title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
}) {
  const map = {
    default: "border-edge bg-raised text-ink hover:border-edge-strong",
    primary: "border-transparent bg-[var(--accent)] text-[var(--bg-raised)] hover:opacity-90",
    ghost: "border-transparent bg-transparent text-muted hover:text-ink hover:bg-sunken",
    danger: "border-edge bg-bad-soft text-bad hover:border-[var(--bad)]",
  } as const;
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        size === "sm" ? "px-2 py-1 text-[11.5px]" : "px-2.5 py-1.5 text-[12.5px]"
      } ${map[tone]}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({
  head, children, dense = false,
}: {
  head: ReactNode[];
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <div className="scroll-x -mx-1 rounded-lg border border-edge">
      <table className="w-full min-w-max border-collapse text-left">
        <thead>
          <tr className="border-b border-edge bg-sunken">
            {head.map((h, i) => (
              <th
                key={i}
                className={`whitespace-nowrap px-2.5 font-medium uppercase tracking-wider text-faint ${
                  dense ? "py-1.5 text-[10px]" : "py-2 text-[10.5px]"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children, mono = false, align = "left", tone, colSpan, className = "",
}: {
  children: ReactNode;
  mono?: boolean;
  align?: "left" | "right" | "center";
  tone?: "ok" | "warn" | "bad" | "muted" | "accent";
  colSpan?: number;
  className?: string;
}) {
  const toneClass = tone
    ? { ok: "text-ok", warn: "text-warn", bad: "text-bad", muted: "text-muted", accent: "text-accent-text" }[tone]
    : "text-ink";
  return (
    <td
      colSpan={colSpan}
      className={`px-2.5 py-1.5 text-[12px] ${mono ? "font-mono tabular-nums" : ""} ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : ""
      } ${toneClass} ${className}`}
    >
      {children}
    </td>
  );
}

export function Tr({ children, highlight }: { children: ReactNode; highlight?: boolean }) {
  return <tr className={highlight ? "bg-accent-soft" : "hover:bg-sunken/60"}>{children}</tr>;
}

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

export function Bar({
  value, max, tone = "accent", label, width = 120,
}: {
  value: number;
  max: number;
  tone?: "accent" | "ok" | "warn" | "bad" | "info" | "muted";
  label?: ReactNode;
  width?: number;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  // Bars use their own grey ramp rather than the state text colours, which are
  // all near-black by design and would make every bar look identical.
  const color = {
    accent: "var(--bar-accent)", ok: "var(--bar-ok)", warn: "var(--bar-warn)",
    bad: "var(--bar-bad)", info: "var(--bar-info)", muted: "var(--bar-muted)",
  }[tone];
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-[7px] shrink-0 overflow-hidden rounded-full bg-sunken"
        style={{ width }}
        role="img"
        aria-label={typeof label === "string" ? label : `${Math.round(pct)}%`}
      >
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      {label && <span className="font-mono text-[11px] tabular-nums text-muted">{label}</span>}
    </div>
  );
}

export function TokenChip({
  text, position, tone = "default", subtitle, title,
}: {
  text: string;
  position?: number;
  tone?: "default" | "accent" | "removed" | "added" | "ok";
  subtitle?: string;
  title?: string;
}) {
  const map = {
    default: "border-edge bg-raised text-ink",
    accent: "border-transparent bg-accent-soft text-accent-text",
    removed: "border-edge bg-sunken text-faint line-through",
    added: "border-transparent bg-ok-soft text-ok",
    ok: "border-transparent bg-ok-soft text-ok",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex flex-col items-center rounded-md border px-1.5 py-1 font-mono text-[12px] leading-tight ${map[tone]}`}
    >
      <span>{text === "" ? <span className="text-faint">ε</span> : text}</span>
      {(position !== undefined || subtitle) && (
        <span className="mt-0.5 text-[9.5px] text-muted">{subtitle ?? position}</span>
      )}
    </span>
  );
}

export function VisualCard({
  icon, title, children, tone = "neutral",
}: {
  icon?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  tone?: "index" | "query" | "neutral" | "ok" | "warn" | "bad";
}) {
  const borderColor = {
    index:   "var(--vis-index)",
    query:   "var(--vis-query)",
    neutral: "var(--border-strong)",
    ok:      "var(--ok)",
    warn:    "var(--warn)",
    bad:     "var(--bad)",
  }[tone];
  const bgColor = {
    index:   "var(--vis-index-soft)",
    query:   "var(--vis-query-soft)",
    neutral: "var(--bg-sunken)",
    ok:      "var(--ok-soft)",
    warn:    "var(--warn-soft)",
    bad:     "var(--bad-soft)",
  }[tone];
  return (
    <div
      className="fade-in rounded-r-xl border border-edge py-3 pl-4 pr-3"
      style={{ borderLeftColor: borderColor, borderLeftWidth: 3, background: bgColor }}
    >
      {(icon || title) && (
        <div className="mb-1.5 flex items-center gap-2">
          {icon && <span className="text-[18px] leading-none">{icon}</span>}
          <span className="text-[13px] font-semibold text-ink">{title}</span>
        </div>
      )}
      <div className="text-[12.5px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export function ConceptFlowStrip({
  steps,
}: {
  steps: { label: string; sublabel?: string; tone?: "index" | "query" | "neutral" }[];
}) {
  const toneClasses = {
    index:   { bg: "bg-[var(--vis-index-soft)]", border: "border-[var(--vis-index)]", text: "text-[var(--vis-index-text)]" },
    query:   { bg: "bg-[var(--vis-query-soft)]", border: "border-[var(--vis-query)]", text: "text-[var(--vis-query-text)]" },
    neutral: { bg: "bg-sunken", border: "border-edge", text: "text-muted" },
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, i) => {
        const t = toneClasses[step.tone ?? "neutral"];
        return (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className={`strip-slide rounded-lg border px-2.5 py-1.5 ${t.bg} ${t.border}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className={`text-[12px] font-semibold leading-tight ${t.text}`}>{step.label}</div>
              {step.sublabel && (
                <div className={`mt-0.5 font-mono text-[10px] opacity-70 ${t.text}`}>{step.sublabel}</div>
              )}
            </div>
            {i < steps.length - 1 && (
              <span className="font-mono text-[11px] text-faint">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-edge-strong px-4 py-6 text-center text-[12.5px] text-faint">
      {children}
    </div>
  );
}

export function KeyValue({ items }: { items: { key: ReactNode; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="divide-y divide-[var(--border)]">
      {items.map((item, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-1.5" title={item.hint}>
          <dt className="text-[12px] text-muted">{item.key}</dt>
          <dd className="text-right font-mono text-[12px] tabular-nums text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Step player: used by every "walk through the algorithm" lab
// ---------------------------------------------------------------------------

export function StepPlayer({
  total, index, onChange, autoPlayMs = 700, label,
}: {
  total: number;
  index: number;
  onChange: (index: number) => void;
  autoPlayMs?: number;
  label?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const atEnd = index >= total - 1;

  // One timeout per step rather than a repeating interval, so the effect always
  // reads the current index instead of chasing it through a ref.
  useEffect(() => {
    if (!playing || total === 0 || index >= total - 1) return;
    const timer = setTimeout(() => onChange(index + 1), autoPlayMs);
    return () => clearTimeout(timer);
  }, [playing, index, total, autoPlayMs, onChange]);

  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => { setPlaying(false); onChange(0); }} disabled={index === 0}>
        ⏮
      </Button>
      <Button size="sm" onClick={() => { setPlaying(false); onChange(Math.max(0, index - 1)); }} disabled={index === 0}>
        ◀
      </Button>
      <Button
        size="sm"
        tone="primary"
        onClick={() => {
          if (atEnd) {
            onChange(0);
            setPlaying(true);
            return;
          }
          setPlaying((p) => !p);
        }}
      >
        {atEnd ? "↻ replay" : playing ? "❚❚ pause" : "▶ play"}
      </Button>
      <Button
        size="sm"
        onClick={() => { setPlaying(false); onChange(Math.min(total - 1, index + 1)); }}
        disabled={index >= total - 1}
      >
        ▶
      </Button>
      <Button size="sm" onClick={() => { setPlaying(false); onChange(total - 1); }} disabled={index >= total - 1}>
        ⏭
      </Button>
      <span className="ml-1 font-mono text-[11.5px] tabular-nums text-muted">
        {label ? `${label} ` : ""}{index + 1} / {total}
      </span>
      <input
        type="range"
        className="ml-auto min-w-[120px] max-w-[280px] flex-1"
        min={0}
        max={Math.max(0, total - 1)}
        value={index}
        onChange={(e) => { setPlaying(false); onChange(Number(e.target.value)); }}
      />
    </div>
  );
}

/**
 * A step index that restarts whenever the number of steps changes — which
 * happens every time the user changes an input and the algorithm reruns.
 *
 * The reset is derived rather than done in an effect: the stored index is
 * tagged with the step count it belongs to, so a stale index simply reads as 0.
 */
export function useSteps(total: number): [number, (i: number) => void] {
  const [state, setState] = useState({ index: 0, forTotal: total });
  const set = useCallback(
    (i: number) => setState({ index: Math.max(0, Math.min(total - 1, i)), forTotal: total }),
    [total],
  );
  const index = state.forTotal === total ? state.index : 0;
  return [Math.min(index, Math.max(0, total - 1)), set];
}

// ---------------------------------------------------------------------------
// Explanation tree (BM25 `explain`)
// ---------------------------------------------------------------------------

export function ExplainTree({ node, depth = 0 }: { node: Explanation; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = (node.details?.length ?? 0) > 0;
  return (
    <div className={depth > 0 ? "border-l border-edge pl-3" : ""}>
      <div className="flex items-baseline gap-2 py-0.5">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-3 shrink-0 font-mono text-[10px] text-faint hover:text-ink"
            aria-label={open ? "collapse" : "expand"}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-accent-text">
          {formatNumber(node.value)}
        </span>
        <span className="text-[12px] leading-snug text-muted">{node.description}</span>
      </div>
      {open && hasChildren && (
        <div className="ml-3">
          {node.details!.map((child, i) => (
            <ExplainTree key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TabContext = createContext<{ active: string; setActive: (v: string) => void } | null>(null);

export function Tabs({
  tabs, initial, children,
}: {
  tabs: { id: string; label: string; hint?: string }[];
  initial?: string;
  children: ReactNode;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? "");
  const value = useMemo(() => ({ active, setActive }), [active]);
  return (
    <TabContext.Provider value={value}>
      <div className="scroll-x mb-3 flex gap-1 border-b border-edge">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={tab.hint}
            onClick={() => setActive(tab.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              active === tab.id
                ? "border-[var(--accent)] text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </TabContext.Provider>
  );
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const ctx = useContext(TabContext);
  if (!ctx || ctx.active !== id) return null;
  return <div className="fade-in">{children}</div>;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
  if (value === 0) return "0";
  if (Number.isInteger(value) && Math.abs(value) < 1e6) return String(value);
  if (Math.abs(value) >= 1e6) return value.toExponential(2);
  if (Math.abs(value) < 0.0001) return value.toExponential(2);
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v.toFixed(1)} ${units[u]}`;
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}
