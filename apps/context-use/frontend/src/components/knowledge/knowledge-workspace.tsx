import { cn } from '@repo/ui/class-names';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { WorkspaceSplitLayout } from '../layout/workspace-split-layout';

type KnowledgeWorkspaceContextValue = {
  collapsed: boolean;
  toggleSidebar: () => void;
};

const KnowledgeWorkspaceContext = createContext<KnowledgeWorkspaceContextValue | null>(null);
const SIDEBAR_STORAGE_KEY = 'context-use:sidebar-collapsed';

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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // Sidebar navigation still works when browser storage is unavailable.
    }
  }, [collapsed]);
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
        'relative grid-rows-[minmax(14rem,22rem)_minmax(0,1fr)]',
        collapsed && 'grid-rows-[0_minmax(0,1fr)] md:grid-cols-[0_minmax(0,1fr)] md:grid-rows-none',
      )}
    >
      {children}
    </WorkspaceSplitLayout>
  );
}
