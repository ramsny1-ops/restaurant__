import { z } from 'zod';
const name = z.string().trim().min(1).max(100);
const price = z.number().int().min(0).max(10000000);
export const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(128),
});
export const staffSchema = z.object({
  name,
  email: z.email().toLowerCase(),
  password: z.string().min(12).max(128),
  role: z.enum(['MANAGER', 'KITCHEN', 'WAITER']),
});
export const itemSchema = z.object({
  name,
  category_id: z.uuid(),
  description: z.string().trim().max(600).default(''),
  price,
  available: z.boolean().default(true),
  prep_minutes: z.number().int().min(1).max(180).default(15),
  image_url: z
    .union([
      z.literal(''),
      z.literal('/assets/images/grilled-chicken.jpg'),
      z.url().refine((u) => u.startsWith('https://'), 'HTTPS images only'),
    ])
    .default(''),
  dietary: z.string().max(150).default(''),
  modifiers: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[a-z0-9_-]+$/)
          .max(50),
        name,
        price,
      }),
    )
    .max(12)
    .refine((m) => new Set(m.map((x) => x.id)).size === m.length, 'Modifier IDs must be unique')
    .default([]),
});
export const orderSchema = z.object({
  expected_total: z.number().int().min(0).max(100000000),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        quantity: z.number().int().min(1).max(20),
        modifiers: z.array(z.string().max(50)).max(12).default([]),
        notes: z.string().trim().max(300).default(''),
      }),
    )
    .min(1)
    .max(30),
  notes: z.string().trim().max(500).default(''),
});
export const nameSchema = z.object({ name });
