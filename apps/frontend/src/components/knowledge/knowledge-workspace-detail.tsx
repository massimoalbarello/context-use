import type { ReactNode } from 'react';

export function KnowledgeWorkspaceDetail({ children }: { children: ReactNode }) {
  return (
    <section className="workspace-detail">
      <div className="workspace-card">{children}</div>
    </section>
  );
}
