import Link from "next/link";
import type { ReactNode } from "react";

/** Chrome for the public legal pages. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="h-full overflow-y-auto bg-canvas text-ink">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          href="/"
          className="text-sm text-ink-muted underline-offset-4 hover:text-accent hover:underline"
        >
          ← BlackBox
        </Link>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-ink-faint">Last updated {updated}</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed">
          {children}
        </div>

        <footer className="mt-16 border-t border-line pt-6 text-sm text-ink-muted">
          <Link href="/privacy" className="hover:text-accent">
            Privacy
          </Link>
          <span className="px-2 text-ink-faint">·</span>
          <Link href="/terms" className="hover:text-accent">
            Terms
          </Link>
        </footer>
      </div>
    </main>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium tracking-tight">{heading}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted">{children}</p>;
}

