import { Link } from '@tanstack/react-router';
import { Menu, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { KnowledgeCollection } from '../../lib/knowledge-navigation';
import { cn } from '../../lib/utils';
import type { KnowledgeProfile } from '../../queries/profile';
import { SignOutButton } from '../auth/sign-out-button';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Button, buttonVariants } from '../ui/button';
import { InfiniteScrollTrigger } from './infinite-scroll-trigger';
import { KnowledgeCollectionNavigation } from './knowledge-collection-navigation';

export function KnowledgeSidebar({
  collection,
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
  collection: KnowledgeCollection;
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
  const profileInitial = profile.selfEntity.name.trim().charAt(0).toLocaleUpperCase();

  return (
    <aside className="knowledge-sidebar" data-collapsed={collapsed}>
      <div className="sidebar-brand">
        <Link className="sidebar-brand-link" to="/pages" aria-label="Context Use">
          <span className="sidebar-brand-copy">
            <strong>Context Use</strong>
            <small>Private workspace</small>
          </span>
        </Link>
        <Button
          className="sidebar-toggle"
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={collapsed ? 'Open sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Menu aria-hidden="true" />
        </Button>
      </div>

      <div className="sidebar-body">
        <div className="sidebar-navigation">
          <KnowledgeCollectionNavigation
            collection={collection}
            ownerEntityId={profile.selfEntity.id}
          />
          <Link className={cn(buttonVariants({ size: 'lg' }), 'sidebar-create')} to={createTo}>
            <Plus data-icon="inline-start" aria-hidden="true" />
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
            <Avatar className="profile-mark" aria-hidden="true">
              <AvatarFallback>{profileInitial}</AvatarFallback>
            </Avatar>
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
