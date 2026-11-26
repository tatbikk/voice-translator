export interface ListCutLines {
  /** the name of the navigation, for a screen reader */
  readonly label: string;
  /** how many are shown, of how many */
  readonly summary: string;
  /** how to see the rest, when there is a next page */
  readonly rest: string | null;
  readonly previous: { readonly href: string; readonly text: string } | null;
  readonly next: { readonly href: string; readonly text: string } | null;
}

/** What a list that does not fit in one page says under it (independent review IR-11): the part shown, and the way to the rest. */
export function ListCut({ lines }: { lines: ListCutLines | null }) {
  if (!lines) return null;
  return (
    <nav aria-label={lines.label} className="mt-4 border-t border-line pt-3 text-sm">
      <p>{lines.summary}</p>
      {lines.rest ? <p className="mt-1 text-text-muted">{lines.rest}</p> : null}
      <p className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {lines.previous ? (
          <a href={lines.previous.href} rel="prev">
            {lines.previous.text}
          </a>
        ) : null}
        {lines.next ? (
          <a href={lines.next.href} rel="next">
            {lines.next.text}
          </a>
        ) : null}
      </p>
    </nav>
  );
}
