import { Elysia, t } from 'elysia';
import { z } from 'zod';
import { ChangeMessageSchema } from '#backend/routes/change-message.ts';

export const changeMessagePlugin = new Elysia({ name: 'change-message' }).macro({
  changeMessage: {
    // Elysia mutates schemas while preparing validators; each route needs its own body.
    get body() {
      return t.Object({
        changeMessage: t.String(z.toJSONSchema(ChangeMessageSchema, { io: 'input' })),
      });
    },
  },
});
