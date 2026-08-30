import type { ReactNode } from 'react';

export function ResourceDetailHeading({
  children,
  actions,
}: {
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="detail-heading-row">
      <p className="eyebrow">{children}</p>
      <div className="action-row detail-actions">{actions}</div>
    </div>
  );
}
