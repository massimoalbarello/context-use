import { ErrorComponent, type ErrorComponentProps, useNavigate } from '@tanstack/react-router';
import {
  DEMO_WRITE_DENIED_EVENT,
  DemoNoticeDialog,
  DemoWriteNotice,
  demoFetch,
} from './write-notice';

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
  const navigate = useNavigate();
  if (!props.error.message.startsWith('This public demo is read-only.')) {
    return <ErrorComponent {...props} />;
  }
  return (
    <DemoNoticeDialog open onClose={() => void navigate({ to: '/hypermedia', replace: true })} />
  );
}
