import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { cn } from '../../lib/class-names';

type KnowledgeWorkspaceContextValue = {
  collapsed: boolean;
  toggleSidebar: () => void;
};

const KnowledgeWorkspaceContext = createContext<KnowledgeWorkspaceContextValue | null>(null);

export function useKnowledgeWorkspace() {
  const context = useContext(KnowledgeWorkspaceContext);
  if (!context) {
    throw new Error('Knowledge workspace components must be rendered inside KnowledgeWorkspace.');
  }
  return context;
}

export function KnowledgeWorkspace({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const context = useMemo(
    () => ({ collapsed, toggleSidebar: () => setCollapsed((value) => !value) }),
    [collapsed],
  );

  return (
    <KnowledgeWorkspaceContext value={context}>
      <main
        className={cn(
          'relative grid h-full min-h-0 grid-rows-[minmax(14rem,22rem)_minmax(0,1fr)] overflow-hidden bg-sidebar md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-none',
          collapsed &&
            'grid-rows-[0_minmax(0,1fr)] md:grid-cols-[0_minmax(0,1fr)] md:grid-rows-none',
        )}
      >
        {children}
      </main>
    </KnowledgeWorkspaceContext>
  );
}
