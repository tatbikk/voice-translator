// Contract §13 item 3 and §4.3: every login and every refusal leaves an event,
// with the actor, the role and a keyed hash of the client — never the address,
// the e-mail, the password or the code.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { login, passGate, startLogin, submitCode, visitor, wrongCode } from '../helpers/auth';
import { capturingEvents, notificationsOf, type EventRow } from '../helpers/db';
import { createUser, newEmail } from '../helpers/factories';
import { Client, loadEndpoints, nextIp } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const actionsOf = (events: readonly EventRow[]) => events.map((e) => e.action);

describe('every login and every refusal leaves an event (contract §13.3)', () => {
  useFreshDatabase();

  it('a complete login leaves the login, the code issued and the second factor', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const { events } = await capturingEvents(() => login(user));
    const actions = actionsOf(events);
    for (const action of ['auth.login.succeeded', 'auth.second-factor.issued', 'auth.second-factor.succeeded']) {
      expect(actions, action).toContain(action);
    }
    const succeeded = events.find((e) => e.action === 'auth.login.succeeded');
    expect(succeeded?.details.identifierHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(events)).not.toContain(user.email);
  });

  it('a login with role selection also leaves auth.role.selected with the chosen role', async () => {
    const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT'] });
    const { events } = await capturingEvents(() => login(user, { role: 'PANEL_PRESIDENT' }));
    const selected = events.find((e) => e.action === 'auth.role.selected');
    expect(selected?.details.role).toBe('PANEL_PRESIDENT');
    expect(selected?.details.roleAssignmentId).toBe(user.roles.find((r) => r.role === 'PANEL_PRESIDENT')?.id);
  });

  it('a wrong passphrase leaves access.code.rejected', async () => {
    const { events } = await capturingEvents(() => passGate(new Client(), `wrong-passphrase-${randomBytes(6).toString('hex')}`));
    expect(actionsOf(events)).toContain('access.code.rejected');
  });

  it('a wrong password leaves auth.login.failed', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const client = await visitor();
    const { events } = await capturingEvents(() => client.post('/api/v1/auth/login', { email: user.email, password: 'Wrong-password-2026' }));
    expect(actionsOf(events)).toContain('auth.login.failed');
  });

  it('an unknown e-mail leaves auth.login.failed as well', async () => {
    const client = await visitor();
    const { events } = await capturingEvents(() => client.post('/api/v1/auth/login', { email: newEmail('nobody'), password: 'Wrong-password-2026' }));
    expect(actionsOf(events)).toContain('auth.login.failed');
  });

  it('a wrong code leaves auth.second-factor.failed', async () => {
    const pending = await startLogin(await createUser({ roles: ['LAWYER'] }));
    const { events } = await capturingEvents(() => submitCode(pending.client, wrongCode(pending.code)));
    expect(actionsOf(events)).toContain('auth.second-factor.failed');
  });

  it('a refused activation leaves account.activation.failed', async () => {
    const client = await visitor();
    const { events } = await capturingEvents(() =>
      client.post('/api/v1/auth/activate', { token: randomBytes(32).toString('base64url'), password: 'Activation-password-2026' }),
    );
    const failed = events.filter((e) => e.action === 'account.activation.failed');
    expect(failed.map((e) => e.details.reason)).toEqual(['INVALID_TOKEN']);
  });

  it('a failed re-authentication leaves auth.reauth.failed', async () => {
    const client = await login(await createUser({ roles: ['LAWYER'] }));
    const { events } = await capturingEvents(() => client.post('/api/v1/auth/reauth', { password: 'Wrong-password-2026' }));
    expect(actionsOf(events)).toContain('auth.reauth.failed');
  });

  it('an attempt on a locked account leaves auth.login.blocked', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const client = await visitor();
    for (let i = 0; i < 5; i += 1) await client.post('/api/v1/auth/login', { email: user.email, password: `Wrong-password-${String(i)}x` });
    const { events } = await capturingEvents(() => client.post('/api/v1/auth/login', { email: user.email, password: user.password }));
    expect(actionsOf(events)).toContain('auth.login.blocked');
  });

  it('a refused request leaves access.denied naming the step and the endpoint id', async () => {
    const endpoints = await loadEndpoints();
    const notifications = endpoints.find((e) => e.method === 'GET' && e.path === '/api/v1/notifications');
    const client = await visitor();
    const { events } = await capturingEvents(() => client.get('/api/v1/notifications'));
    const denied = events.filter((e) => e.action === 'access.denied');
    expect(denied.length).toBe(1);
    expect(denied[0]?.outcome).toBe('DENIED');
    expect(denied[0]?.details.step).toBe('SESSION');
    expect(denied[0]?.details.target).toBe(notifications?.id);
    expect(typeof denied[0]?.details.reason).toBe('string');
  });

  it('the events of a session carry the actor, the role assignment and the role', async () => {
    const user = await createUser({ roles: ['CLERK_HEARING'] });
    const client = await login(user);
    const id = (await notificationsOf(user.id))[0]?.id ?? '';
    const { events } = await capturingEvents(() => client.post(`/api/v1/notifications/${id}/read`));
    const read = events.find((e) => e.action === 'notification.read');
    expect(read?.actorUserId).toBe(user.id);
    expect(read?.actorRoleAssignmentId).toBe(user.roleAssignmentId);
    expect(read?.actorRole).toBe('CLERK_HEARING');
    expect(read?.viaDemoSwitch).toBe(false);
    expect(read?.clientIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(read?.occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('a refusal from an address is logged with a keyed hash of the address, never the address', async () => {
    const ip = nextIp();
    const { events } = await capturingEvents(() => new Client({ ip }).get('/api/v1/notifications'));
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(ip);
    expect(events[0]?.clientIdHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two requests from one address carry the same client hash; another address another one', async () => {
    const ip = nextIp();
    const a = await capturingEvents(() => new Client({ ip }).get('/api/v1/notifications'));
    const b = await capturingEvents(() => new Client({ ip }).get('/api/v1/notifications'));
    const c = await capturingEvents(() => new Client({ ip: nextIp() }).get('/api/v1/notifications'));
    expect(a.events[0]?.clientIdHash).toBe(b.events[0]?.clientIdHash);
    expect(c.events[0]?.clientIdHash).not.toBe(a.events[0]?.clientIdHash);
  });
});
