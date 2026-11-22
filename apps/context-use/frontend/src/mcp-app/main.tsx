import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { initialNotice, initialPage, launchResource, PagesClient } from './client';
import { PagesApp } from './pages-app';
import { resourceQueryKey, searchQueryKey } from './queries';
import './styles.css';

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
  const page = initialPage(received);
  const launch = launchResource(received);
  const search = launch?.kind === 'search' ? launch.data : undefined;
  const address = launch && launch.kind !== 'search' ? launch.data.address : page?.address;
  if (page) {
    queryClient.setQueryData(resourceQueryKey(page.address), { kind: 'page', value: page });
  }
  if (launch && launch.kind !== 'search') {
    queryClient.setQueryData(resourceQueryKey(launch.data.address), {
      kind: launch.kind,
      value: launch.data,
    });
  }
  if (search) {
    queryClient.setQueryData([...searchQueryKey, search.query, search.resourceType], search);
  }
  if (mounted && !search) {
    void queryClient.invalidateQueries({ queryKey: searchQueryKey });
  }
  root.render(
    <QueryClientProvider client={queryClient}>
      <PagesApp
        key={JSON.stringify([address, search?.query, search?.resourceType])}
        client={client}
        initial={page}
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
