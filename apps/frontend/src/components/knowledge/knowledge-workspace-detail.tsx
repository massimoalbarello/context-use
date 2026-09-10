import type { ReactNode } from 'react';

export function KnowledgeWorkspaceDetail({ children }: { children: ReactNode }) {
  return (
    <section className="min-h-0 min-w-0 overflow-hidden overscroll-none p-2 md:p-3">
      <div className="h-full min-h-0 overflow-y-auto overscroll-none rounded-2xl bg-card">
        {children}
      </div>
    </section>
  );
}
