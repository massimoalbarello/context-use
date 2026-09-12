import { ErrorComponent, type ErrorComponentProps, Link } from '@tanstack/react-router';
import { buttonVariants } from '../src/components/ui/button';
import { DEMO_WRITE_DENIED_EVENT, DemoWriteNotice, demoFetch } from './write-notice';

// Install before either API client initializes, including the account client.
const writeNotices = new EventTarget();
const browser: Window = window;
const fetch = browser.fetch.bind(browser);
browser.fetch = (...args) => {
  const returnFocus = document.activeElement;
  return demoFetch({
    fetch,
    onWriteDenied: () =>
      writeNotices.dispatchEvent(new CustomEvent(DEMO_WRITE_DENIED_EVENT, { detail: returnFocus })),
  })(...args);
};

const { Route } = await import('../src/routes/__root');
// Account screens load protected APIs. Explain their denial without changing those screens.
const Workspace = Route.options.component!;
Route.update({ component: DemoWorkspace, errorComponent: DemoRouteError });
await import('../src/main');

function DemoWorkspace() {
  return (
    <>
      <Workspace />
      <DemoWriteNotice events={writeNotices} />
    </>
  );
}

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
