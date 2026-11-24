import 'server-only';
import { availableActions, resolveLegalBasis, type ActionRule, type AuthorizationContext, type Resource, type Subject } from '@mahkama/core';
import { legalBasisText } from '@/components/shell/legal-basis-text';
import type { Translator } from '@/i18n/translate';

// The action bar of a case file (interface book, «العناصر المشتركة»): the
// buttons the core grants, each with the three lines of its confirmation window.

export interface ActionView {
  readonly code: string;
  readonly label: string;
  readonly effect: string;
  readonly notified: string;
  readonly legalBasis: string;
  readonly level: ActionRule['level'];
  readonly signature: boolean;
  readonly awaited: boolean;
}

export function actionViews(t: Translator, subject: Subject, resource: Resource, context: AuthorizationContext): ActionView[] {
  return availableActions(subject, resource, context).map((rule) => ({
    code: rule.code,
    label: t(rule.labelKey),
    effect: rule.confirm ? t(rule.effectKey) : '',
    notified: rule.confirm ? t(rule.notifiedKey) : '',
    legalBasis: legalBasisText(t, resolveLegalBasis(rule, resource)),
    level: rule.level,
    signature: rule.procedure?.signature ?? false,
    awaited: rule.procedure?.awaited ?? false,
  }));
}
