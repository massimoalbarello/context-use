import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/geist-mono';
import ReactDOM from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './styles.css';

function createApplicationRouter() {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createApplicationRouter>;
  }
}

export function mountDashboard() {
  const router = createApplicationRouter();
  const queryClient = router.options.context!.queryClient;
  const rootElement = document.getElementById('app')!;

  if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }
}
