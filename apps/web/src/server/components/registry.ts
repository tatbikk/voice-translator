import 'server-only';
import type { ReplaceableComponent } from '@mahkama/core';
import { professionalIdentity } from '../identity';
import { messaging } from '../messaging';

/** The replaceable components that exist in the code today (boot check, «مكونات بيئة العرض»). */
export function replaceableComponents(): ReplaceableComponent[] {
  return [messaging().component, professionalIdentity().component];
}
