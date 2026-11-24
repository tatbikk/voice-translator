/**
 * Reserved place of the official logo, of fixed size, in the top bar and at the
 * head of every generated document (rule 10 of the prompt). In the demo
 * environment it holds a neutral frame: no official emblem is ever embedded.
 */
export function LogoSlot({ label, logoUrl }: { label: string; logoUrl: string | null }) {
  return (
    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong bg-canvas p-0.5 text-center text-[0.5625rem] leading-tight text-text-muted">
      {logoUrl ? <img src={logoUrl} alt={label} className="h-full w-full object-contain" /> : <span>{label}</span>}
    </span>
  );
}
