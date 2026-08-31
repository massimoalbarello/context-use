import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (context.session) {
      throw redirect({ to: '/entities' });
    }
    throw redirect({ to: '/login', search: { redirect: '/entities' } });
  },
});
