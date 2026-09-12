import { ErrorComponent, type ErrorComponentProps, Link } from '@tanstack/react-router';
import { buttonVariants } from '../src/components/ui/button';
import { Route } from '../src/routes/__root';

// Account screens load protected APIs. Explain their denial without changing those screens.
Route.update({ errorComponent: DemoRouteError });
await import('../src/main');

function DemoRouteError(props: ErrorComponentProps) {
  if (!props.error.message.startsWith('This public demo is read-only.')) {
    return <ErrorComponent {...props} />;
  }
  return (
    <main className="grid h-full place-items-center bg-sidebar p-6">
      <section className="grid max-w-lg gap-4 rounded-2xl bg-card p-8">
        <h1 className="font-semibold text-2xl">Read-only demo</h1>
        <p className="text-muted-foreground">
          Account settings and MCP access are unavailable in this public demo. You can still explore
          Steve’s pages, entities, assets and records.
        </p>
        <Link className={buttonVariants({ className: 'w-fit' })} to="/hypermedia">
          Back to Hypermedia
        </Link>
      </section>
    </main>
  );
}
