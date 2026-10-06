"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CHAPTERS, PARTS, type Chapter } from "@/lib/chapters";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"];

const EXTRA_LINKS = [
  { href: "/playground", label: "Search playground", note: "The whole engine, one page" },
  { href: "/corpus", label: "The corpus", note: "Every document and field" },
  { href: "/tests", label: "Differential tests", note: "Chapter 42, running live" },
];

type Theme = "system" | "light" | "dark";

const THEME_EVENT = "kaus-theme-change";

/**
 * The theme lives on the `<html>` element, put there by an inline script before
 * first paint so there is no flash. That makes the DOM the source of truth, not
 * React — so we subscribe to it rather than keeping a second copy in state.
 */
function subscribeToTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function readTheme(): Theme {
  const attribute = document.documentElement.getAttribute("data-theme");
  return attribute === "light" || attribute === "dark" ? attribute : "system";
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => "system" as Theme);

  const apply = (next: Theme) => {
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("kaus-theme");
    } else {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("kaus-theme", next);
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  return (
    <div className="flex gap-0.5 rounded-lg border border-edge bg-sunken p-0.5">
      {([
        { id: "light", glyph: "☀", label: "Light" },
        { id: "system", glyph: "◐", label: "System" },
        { id: "dark", glyph: "☾", label: "Dark" },
      ] as const).map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.label}
          aria-label={option.label}
          aria-pressed={theme === option.id}
          onClick={() => apply(option.id)}
          className={`rounded-md px-1.5 py-0.5 text-[12px] transition-colors ${
            theme === option.id ? "bg-raised text-ink shadow-[var(--shadow)]" : "text-faint hover:text-ink"
          }`}
        >
          {option.glyph}
        </button>
      ))}
    </div>
  );
}

function ChapterLink({ chapter, active }: { chapter: Chapter; active: boolean }) {
  return (
    <Link
      href={`/ch/${chapter.slug}`}
      className={`group flex items-baseline gap-2 rounded-md px-2 py-[5px] text-[12.5px] leading-snug transition-colors ${
        active ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-sunken hover:text-ink"
      }`}
    >
      <span className={`w-5 shrink-0 text-right font-mono text-[11px] tabular-nums ${active ? "text-accent-text" : "text-faint"}`}>
        {chapter.number}
      </span>
      <span className="min-w-0">{chapter.title}</span>
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [filter, setFilter] = useState("");

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return null;
    return new Set(
      CHAPTERS.filter((c) =>
        `${c.number} ${c.title} ${c.summary} ${c.question} ${c.structure}`.toLowerCase().includes(needle),
      ).map((c) => c.slug),
    );
  }, [filter]);

  return (
    <nav className="flex h-full flex-col" onClick={onNavigate}>
      <div className="border-b border-edge p-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder="Filter chapters"
          className="w-full rounded-lg border border-edge bg-raised px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[var(--accent)]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-3 space-y-0.5">
          <Link
            href="/"
            className={`block rounded-md px-2 py-[5px] text-[12.5px] font-medium transition-colors ${
              pathname === "/" ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-sunken hover:text-ink"
            }`}
          >
            Overview
          </Link>
          {EXTRA_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              title={link.note}
              className={`block rounded-md px-2 py-[5px] text-[12.5px] font-medium transition-colors ${
                pathname === link.href ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-sunken hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {PARTS.map((part) => {
          const chapters = CHAPTERS.filter((c) => c.partNumber === part.number);
          const visible = matches ? chapters.filter((c) => matches.has(c.slug)) : chapters;
          if (visible.length === 0) return null;
          return (
            <div key={part.number} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                {ROMAN[part.number]} · {part.title}
              </div>
              <div className="space-y-px">
                {visible.map((chapter) => (
                  <ChapterLink
                    key={chapter.slug}
                    chapter={chapter}
                    active={pathname === `/ch/${chapter.slug}`}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {matches?.size === 0 && (
          <p className="px-2 py-4 text-[12px] text-faint">No chapter matches that.</p>
        )}
      </div>
    </nav>
  );
}

/** Reading-progress rail: a 2px ink line growing along the header's bottom edge. */
function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const p = max > 0 ? Math.min(1, doc.scrollTop / max) : 0;
      el.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-[2px]">
      <div ref={ref} className="h-full w-full origin-left" style={{ transform: "scaleX(0)", background: "var(--text)" }} />
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur-md">
        <div className="flex items-center gap-3 px-3 py-2.5 lg:px-5">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-lg border border-edge px-2 py-1 text-[13px] text-muted hover:text-ink lg:hidden"
            aria-label="Toggle chapter navigation"
            aria-expanded={menuOpen}
          >
            ☰
          </button>

          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-mono text-[15px] font-bold tracking-tight text-ink">KAUS</span>
            <span className="hidden text-[11.5px] text-faint sm:inline">
              building a search engine from first principles
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/playground"
              className="hidden rounded-lg border border-edge bg-raised px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:text-ink sm:block"
            >
              Playground
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <ScrollProgress />
      </header>

      <div className="mx-auto flex w-full max-w-[1680px]">
        <aside className="sticky top-[49px] hidden h-[calc(100vh-49px)] w-[260px] shrink-0 border-r border-edge lg:block">
          <Nav />
        </aside>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 top-[49px] z-30 bg-black/40 lg:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <aside className="fixed left-0 top-[49px] z-40 h-[calc(100vh-49px)] w-[280px] border-r border-edge bg-raised lg:hidden">
              <Nav onNavigate={() => setMenuOpen(false)} />
            </aside>
          </>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
