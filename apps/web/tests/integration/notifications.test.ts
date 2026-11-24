// Memo row 11: marking or reading someone else's notification by changing the
// id. Ownership is checked on the server and the answer is "not found", never
// "forbidden", identical for a foreign, an unknown and a malformed id
// (contract §6: path-parameter routes answer 404 for a malformed id).
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { login } from '../helpers/auth';
import { capturingEvents, notificationsOf } from '../helpers/db';
import { createNotification, createUser, type TestUser } from '../helpers/factories';
import { describeResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

let owner!: TestUser;
let stranger!: TestUser;
let ownerClient!: Client;

/** Ids of the listed notifications, whether the data is the list itself or { items }. */
function listedIds(data: unknown): string[] {
  const items: unknown = Array.isArray(data) ? data : (data as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? items.map((n) => String((n as { id?: unknown }).id)) : [];
}

describe('notifications (memo row 11)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    owner = await createUser({ roles: ['LAWYER'] });
    stranger = await createUser({ roles: ['LAWYER'] });
    ownerClient = await login(owner);
  });

  it("row 11: marking someone else's notification answers 404, exactly like an unknown or a malformed id", async () => {
    const foreignId = (await notificationsOf(stranger.id))[0]?.id ?? '';
    const { result: foreign, events } = await capturingEvents(() => ownerClient.post(`/api/v1/notifications/${foreignId}/read`));
    const unknown = await ownerClient.post(`/api/v1/notifications/${randomUUID()}/read`);
    const malformed = await ownerClient.post('/api/v1/notifications/not-a-uuid/read');
    for (const res of [foreign, unknown, malformed]) {
      expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 404, code: 'NOT_FOUND' });
    }
    expect(new Set([foreign.text, unknown.text, malformed.text]).size, 'one identical answer').toBe(1);
    expect((await notificationsOf(stranger.id))[0]?.readAt ?? null, "the other user's notification is untouched").toBeNull();
    const denied = events.filter((e) => e.action === 'access.denied');
    expect(denied.length, 'the refusal is logged').toBeGreaterThan(0);
    expect(['AUTHZ', 'PARAMS']).toContain(denied[0]?.details.step);
    expect(events.map((e) => e.action)).not.toContain('notification.read');
  });

  it("row 11: the list holds the caller's notifications only", async () => {
    const res = await ownerClient.get('/api/v1/notifications');
    expect(res.status, describeResponse(res)).toBe(200);
    const ids = listedIds(res.data);
    const own = (await notificationsOf(owner.id)).map((n) => n.id);
    const foreign = (await notificationsOf(stranger.id)).map((n) => n.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of own) expect(ids).toContain(id);
    for (const id of foreign) expect(ids).not.toContain(id);
    expect(res.text).not.toContain(stranger.email);
  });

  it("row 11: marking one's own notification works and is logged", async () => {
    const id = await createNotification(owner.id, { kind: 'REMINDER' });
    const { result: res, events } = await capturingEvents(() => ownerClient.post(`/api/v1/notifications/${id}/read`));
    expect(res.status, describeResponse(res)).toBe(200);
    expect((await notificationsOf(owner.id)).find((n) => n.id === id)?.readAt).not.toBeNull();
    const read = events.filter((e) => e.action === 'notification.read');
    expect(read.length).toBe(1);
    expect(read[0]?.details).toEqual({ notificationId: id });
    expect(read[0]?.actorUserId).toBe(owner.id);
  });

  it('the list accepts the background-refresh header', async () => {
    const res = await ownerClient.get('/api/v1/notifications', { headers: { 'X-Background-Refresh': '1' } });
    expect(res.status, describeResponse(res)).toBe(200);
  });
});
