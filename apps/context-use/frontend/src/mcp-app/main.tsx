import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { initialNotice, launchResource, PagesClient } from './client';
import { PagesApp } from './pages-app';
import { resourceQueryKey, searchQueryKey } from './queries';
import { WidgetLoading } from './widget-loading';
import '../styles.css';

const app = new App({ name: 'Context Use', version: '1.0.0' }, {}, { autoResize: false });
const client = new PagesClient(app);
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const root = createRoot(document.getElementById('root')!);
let mounted = false;
let connected = false;
let received: Parameters<NonNullable<App['ontoolresult']>>[0] | undefined;
function renderResult() {
  if (!connected || !received) {
    return;
  }
  const { address, search, page } = launchResource(received);
  if (page) {
    queryClient.setQueryData(resourceQueryKey(page.value.address), page);
  }
  if (mounted && !search) {
    void queryClient.invalidateQueries({ queryKey: searchQueryKey });
  }
  root.render(
    <QueryClientProvider client={queryClient}>
      <PagesApp
        key={JSON.stringify([address, search])}
        client={client}
        initialSearch={search}
        initialAddress={address}
        initialNotice={initialNotice(received)}
      />
    </QueryClientProvider>,
  );
  mounted = true;
}
function theme(value?: string) {
  if (value === 'dark' || value === 'light') {
    applyDocumentTheme(value);
    document.documentElement.classList.toggle('dark', value === 'dark');
  }
}
theme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
app.onhostcontextchanged = (context) => theme(context.theme);
app.ontoolresult = (result) => {
  received = result;
  renderResult();
};
root.render(
  <main className="mx-auto max-w-3xl p-4 sm:p-6">
    <WidgetLoading label="Loading Context Use" />
  </main>,
);
app
  .connect()
  .then(() => {
    connected = true;
    theme(app.getHostContext()?.theme);
    renderResult();
  })
  .catch((error: unknown) => {
    root.render(
      <p role="alert" className="p-6">
        Could not connect to Context Use. Reopen this app to try again.{' '}
        {error instanceof Error ? error.message : ''}
      </p>,
    );
  });
