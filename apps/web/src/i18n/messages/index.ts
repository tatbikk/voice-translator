// Every text a user reads. Files are split by area (to avoid edit conflicts)
// but keys are flat and global; a unit test refuses a key defined twice.
import arActions from './ar/actions.json';
import arAdmin from './ar/admin.json';
import arAuth from './ar/auth.json';
import arCommon from './ar/common.json';
import arComponents from './ar/components.json';
import arDashboard from './ar/dashboard.json';
import arDemo from './ar/demo.json';
import arErrors from './ar/errors.json';
import arMessages from './ar/messages.json';
import arPublic from './ar/public.json';
import arRoles from './ar/roles.json';
import frCommon from './fr/common.json';
import zghCommon from './zgh/common.json';
import type { Locale } from '../locales';

export type Messages = Readonly<Record<string, string>>;

export const AR_FILES: Readonly<Record<string, Messages>> = {
  actions: arActions,
  admin: arAdmin,
  auth: arAuth,
  common: arCommon,
  components: arComponents,
  dashboard: arDashboard,
  demo: arDemo,
  errors: arErrors,
  messages: arMessages,
  public: arPublic,
  roles: arRoles,
};

export const MESSAGES: Readonly<Record<Locale, Messages>> = {
  ar: Object.assign({}, ...Object.values(AR_FILES)) as Messages,
  fr: frCommon,
  zgh: zghCommon,
};
