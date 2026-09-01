import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { cn } from '../../lib/class-names';
import { WorkspaceSplitLayout } from '../layout/workspace-split-layout';

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
      <WorkspaceSplitLayout
        className={cn(
          'relative grid-rows-[minmax(14rem,22rem)_minmax(0,1fr)]',
          collapsed &&
            'grid-rows-[0_minmax(0,1fr)] md:grid-cols-[0_minmax(0,1fr)] md:grid-rows-none',
        )}
      >
        {children}
      </WorkspaceSplitLayout>
    </KnowledgeWorkspaceContext>
  );
}
