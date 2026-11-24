// Replaceable components: everything that depends on an outside party sits
// behind one internal interface with a simulated implementation today and a
// real one later (the prompt's «المكونات المؤقتة وكيف تستبدل»). The descriptor
// feeds the boot check and the page «مكونات بيئة العرض»; code interface names
// are documented in docs/production-readiness.md, never shown to users.

export type ComponentImplementation = 'simulated' | 'real' | 'test';

export interface ReplaceableComponent {
  readonly id: string;
  /** i18n keys */
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly replacementKey: string;
  readonly implementation: ComponentImplementation;
}

export function simulatedComponents(components: readonly ReplaceableComponent[]): ReplaceableComponent[] {
  return components.filter((c) => c.implementation === 'simulated');
}
