import { Elysia, t } from 'elysia';
import { z } from 'zod';
import { ChangeMessageSchema } from '#backend/routes/change-message.ts';

const body = t.Object({
  changeMessage: t.String(z.toJSONSchema(ChangeMessageSchema, { io: 'input' })),
});

export const changeMessagePlugin = new Elysia({ name: 'change-message' }).macro({
  changeMessage: { body },
});
