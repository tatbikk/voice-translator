import 'server-only';
import type { ReplaceableComponent } from '@mahkama/core';
import { professionalIdentity } from '../identity';
import { messaging } from '../messaging';
import { paymentGateway } from '../payments/gateway';
import { commercialRegister } from '../registers/commercial';
import { signatureProvider } from '../signature/provider';

/** The replaceable components that exist in the code today (boot check, «مكونات بيئة العرض»). */
export function replaceableComponents(): ReplaceableComponent[] {
  return [messaging().component, professionalIdentity().component, signatureProvider().component, paymentGateway().component, commercialRegister().component];
}
