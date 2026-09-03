import { createFileRoute, redirect } from '@tanstack/react-router';
import { MAIN_KNOWLEDGE_PATH } from '../lib/knowledge-navigation';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (context.session) {
      throw redirect({ to: MAIN_KNOWLEDGE_PATH });
    }
    throw redirect({ to: '/login', search: { redirect: MAIN_KNOWLEDGE_PATH } });
  },
});
