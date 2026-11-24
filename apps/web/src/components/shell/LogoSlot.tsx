/**
 * Reserved place of the official logo, of fixed size, in the top bar and at the
 * head of every generated document (rule 10 of the prompt). In the demo
 * environment it holds a neutral frame: no official emblem is ever embedded.
 */
export function LogoSlot({ label, logoUrl, decorative = false }: { label: string; logoUrl: string | null; decorative?: boolean }) {
  return (
    <span className="inline-flex h-[48px] w-[48px] shrink-0 items-center justify-center overflow-hidden rounded-sm border border-dashed border-line-strong bg-canvas text-center text-[10px] leading-[1.15] [overflow-wrap:anywhere] text-text-muted">
      {logoUrl ? (
        <img src={logoUrl} alt={decorative ? '' : label} className="h-full w-full object-contain" />
      ) : (
        <span aria-hidden={decorative ? 'true' : undefined}>{label}</span>
      )}
    </span>
  );
}
