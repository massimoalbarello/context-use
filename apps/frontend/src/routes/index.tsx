import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (context.session) {
      throw redirect({ to: '/pages' });
    }
    throw redirect({ to: '/login', search: { redirect: '/pages' } });
  },
});
