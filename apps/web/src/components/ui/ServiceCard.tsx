/**
 * A service open without an account, as a card: its name is the link, and the
 * whole card is the target. The description stays outside the link's name.
 */
export function ServiceCard({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <div className="card group relative flex h-full flex-col p-6 transition-colors hover:border-ink-300 hover:bg-ink-50">
      <a
        href={href}
        className="flex items-center justify-between gap-3 font-naskh text-lg font-bold text-ink-900 no-underline after:absolute after:inset-0"
      >
        {title}
        <span aria-hidden="true" className="text-ink-700 transition-transform group-hover:-translate-x-1 ltr:-scale-x-100 ltr:group-hover:translate-x-1">
          ←
        </span>
      </a>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-text-muted">{text}</p>
    </div>
  );
}
