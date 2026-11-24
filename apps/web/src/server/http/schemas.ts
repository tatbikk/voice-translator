import 'server-only';
import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';

// Input schemas shared by the routes. Every string has a maximum length; the
// server never trusts a check made in the browser.

const f = SECURITY_POLICY.fields;

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(f.email)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
export const loginPasswordSchema = z.string().min(1).max(f.passwordMax);
export const newPasswordSchema = z.string().min(f.passwordMin).max(f.passwordMax);
export const codeSchema = z.string().regex(/^\d{6}$/);
export const uuidSchema = z.uuid();
export const nameSchema = z.string().trim().min(2).max(f.name);
export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(f.phone)
  .regex(/^\+?[0-9 ]{6,}$/);
export const nextPathSchema = z.string().max(2048).optional();
