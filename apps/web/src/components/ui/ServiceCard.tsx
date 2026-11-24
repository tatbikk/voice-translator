/**
 * A service open without an account, as a card: its name is a heading holding
 * the link, the whole card is the target and shows the focus ring, and the
 * description stays outside the link's name.
 */
export function ServiceCard({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <div
      className={
        'card group relative flex h-full flex-col p-6 transition-colors hover:border-ink-600 hover:bg-ink-50 ' +
        'has-[a:focus-visible]:[outline:3px_solid_var(--color-focus)] has-[a:focus-visible]:[outline-offset:2px]'
      }
    >
      <h3 className="text-lg">
        <a
          href={href}
          className="flex items-center justify-between gap-3 text-ink-900 no-underline after:absolute after:inset-0 focus-visible:[outline:none]"
        >
          {title}
          <span aria-hidden="true" className="text-ink-700 transition-transform group-hover:-translate-x-1 ltr:-scale-x-100 ltr:group-hover:translate-x-1">
            ←
          </span>
        </a>
      </h3>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-text-muted">{text}</p>
    </div>
  );
}
