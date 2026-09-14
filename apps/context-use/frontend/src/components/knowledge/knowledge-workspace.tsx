import { cn } from '@repo/ui/class-names';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { isNarrowWorkspace } from '../../lib/hooks/use-narrow-workspace';
import { WorkspaceSplitLayout } from '../layout/workspace-split-layout';

type KnowledgeWorkspaceContextValue = {
  collapsed: boolean;
  toggleSidebar: () => void;
};

const KnowledgeWorkspaceContext = createContext<KnowledgeWorkspaceContextValue | null>(null);

export function useKnowledgeWorkspace() {
  const context = useContext(KnowledgeWorkspaceContext);
  if (!context) {
    throw new Error(
      'Knowledge workspace components must be rendered inside KnowledgeWorkspaceProvider.',
    );
  }
  return context;
}

export function KnowledgeWorkspaceProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && isNarrowWorkspace(),
  );
  const context = useMemo(
    () => ({ collapsed, toggleSidebar: () => setCollapsed((value) => !value) }),
    [collapsed],
  );

  return <KnowledgeWorkspaceContext value={context}>{children}</KnowledgeWorkspaceContext>;
}

export function KnowledgeWorkspace({ children }: { children: ReactNode }) {
  const { collapsed } = useKnowledgeWorkspace();
  return (
    <WorkspaceSplitLayout
      className={cn(
        'relative grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[16rem_minmax(0,1fr)]',
        collapsed && 'grid-rows-[0_minmax(0,1fr)] md:grid-cols-[0_minmax(0,1fr)] md:grid-rows-none',
      )}
    >
      {children}
    </WorkspaceSplitLayout>
  );
}
