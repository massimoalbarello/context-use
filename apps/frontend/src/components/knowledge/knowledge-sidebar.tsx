import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import type { KnowledgeProfile } from '../../queries/profile';
import { SignOutButton } from '../auth/sign-out-button';
import { InfiniteScrollTrigger } from './infinite-scroll-trigger';

export function KnowledgeSidebar({
  section,
  count,
  createTo,
  createLabel,
  profile,
  error,
  hasNextPage,
  isFetchingNextPage,
  loadMore,
  children,
}: {
  section: 'pages' | 'entities';
  count: number;
  createTo: '/pages/new' | '/entities/new';
  createLabel: string;
  profile: KnowledgeProfile;
  error?: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMore: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const initialLoadFailed = Boolean(error && count === 0);
  const sectionLabel = section === 'pages' ? 'Pages' : 'Entities';
  const profileInitial = profile.selfEntity.name.trim().charAt(0).toLocaleUpperCase();

  return (
    <aside className="knowledge-sidebar" data-collapsed={collapsed}>
      <div className="sidebar-brand">
        <Link className="sidebar-brand-link" to="/pages" aria-label="Context Use">
          <span className="brand-mark" aria-hidden="true">
            CU
          </span>
          <span className="sidebar-brand-copy">
            <strong>Context Use</strong>
            <small>Private workspace</small>
          </span>
        </Link>
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={collapsed ? 'Open sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <span aria-hidden="true">{collapsed ? '☰' : '‹'}</span>
        </button>
      </div>

      <div className="sidebar-body">
        <nav className="sidebar-sections" aria-label="Knowledge collections">
          <Link to="/pages" activeProps={{ 'data-active': true }}>
            Pages
          </Link>
          <Link to="/entities" activeProps={{ 'data-active': true }}>
            Entities
          </Link>
        </nav>

        <div className="sidebar-actions">
          <div>
            <h1>{sectionLabel}</h1>
            <span className="count-badge">{count}</span>
          </div>
          <Link className="sidebar-create" to={createTo}>
            <span className="create-icon" aria-hidden="true">
              +
            </span>
            {createLabel}
          </Link>
        </div>

        <div className="sidebar-scroll">
          {initialLoadFailed ? (
            <p className="error-message sidebar-error">{error?.message}</p>
          ) : (
            <>
              {children}
              <InfiniteScrollTrigger
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                error={error}
                loadMore={loadMore}
              />
            </>
          )}
        </div>

        <footer className="sidebar-footer">
          <Link
            className="sidebar-profile"
            to="/entities/$id"
            params={{ id: profile.selfEntity.readableId }}
          >
            <span className="profile-mark" aria-hidden="true">
              {profileInitial}
            </span>
            <span>
              <strong>{profile.selfEntity.name}</strong>
              <small>Your entity</small>
            </span>
          </Link>
          <SignOutButton />
        </footer>
      </div>
    </aside>
  );
}
