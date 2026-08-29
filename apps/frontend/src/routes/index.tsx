import { createFileRoute, Link, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (context.session) {
      throw redirect({ to: '/pages' });
    }
  },
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <main className="welcome-shell">
      <p className="eyebrow">Context Use</p>
      <h1>Knowledge should get clearer as evidence accumulates.</h1>
      <p>
        Build a small hypermedia of focused knowledge pages, connected to stable entities through
        explicit links.
      </p>
      <Link className="primary-action" to="/login" search={{ redirect: '/pages' }}>
        Continue with a passkey
      </Link>
    </main>
  );
}
