import type { ReactNode } from 'react';

export function KnowledgeWorkspaceDetail({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden overscroll-none p-2 md:p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card">
        {children}
      </div>
    </section>
  );
}
