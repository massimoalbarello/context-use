import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { initialNotice, launchResource, PagesClient } from './client';
import { PagesApp } from './pages-app';
import { resourceQueryKey, searchQueryKey } from './queries';
import '../styles.css';

const app = new App({ name: 'Context Use', version: '1.0.0' });
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
  const launch = launchResource(received);
  const search = launch?.kind === 'search' ? launch.value : undefined;
  const resource = launch?.kind === 'search' ? undefined : launch;
  const address = resource?.value.address;
  if (resource) {
    queryClient.setQueryData(resourceQueryKey(resource.value.address), resource);
  }
  if (search) {
    queryClient.setQueryData([...searchQueryKey, search.input], search);
  }
  if (mounted && !search) {
    void queryClient.invalidateQueries({ queryKey: searchQueryKey });
  }
  root.render(
    <QueryClientProvider client={queryClient}>
      <PagesApp
        key={JSON.stringify([address, search?.input])}
        client={client}
        initialSearch={search?.input}
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
app.onhostcontextchanged = (context) => theme(context.theme);
app.ontoolresult = (result) => {
  received = result;
  renderResult();
};
root.render(
  <p role="status" className="p-6">
    Connecting to Context Use…
  </p>,
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
