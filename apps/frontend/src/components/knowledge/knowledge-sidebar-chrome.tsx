import { Link } from '@tanstack/react-router';
import { Menu, Settings } from 'lucide-react';
import { cn } from '../../lib/class-names';
import { MAIN_KNOWLEDGE_PATH } from '../../lib/knowledge-navigation';
import type { KnowledgeProfile } from '../../queries/profile';
import { SignOutButton } from '../auth/sign-out-button';
import { EntityAvatar } from '../entities/entity-link';
import { Button, buttonVariants } from '../ui/button';
import { useKnowledgeWorkspace } from './knowledge-workspace';

export function KnowledgeSidebarHeader() {
  const { collapsed, toggleSidebar } = useKnowledgeWorkspace();

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-3 p-3',
        collapsed && 'absolute top-6 left-6 items-center justify-center p-0 md:top-7 md:left-7',
      )}
    >
      <Link
        className={cn('flex min-w-0 items-center', collapsed && 'hidden')}
        to={MAIN_KNOWLEDGE_PATH}
        aria-label="Context Use"
      >
        <span className="grid min-w-0 leading-tight">
          <strong className="truncate font-semibold text-sm">Context Use</strong>
          <small className="truncate text-muted-foreground text-xs">Private workspace</small>
        </span>
      </Link>
      <Button
        className={cn(
          'size-10 shrink-0 rounded-xl bg-transparent text-muted-foreground [&_svg]:size-5',
          collapsed && 'size-11 bg-muted shadow-lg hover:bg-accent hover:text-accent-foreground',
        )}
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label={collapsed ? 'Open sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        onClick={toggleSidebar}
      >
        <Menu aria-hidden="true" />
      </Button>
    </div>
  );
}

export function KnowledgeSidebarFooter({ profile }: { profile: KnowledgeProfile }) {
  return (
    <footer className="flex shrink-0 items-center gap-2 px-3 py-3">
      <Link
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-card"
        to="/entities/$id"
        params={{ id: profile.selfEntity.readableId }}
      >
        <EntityAvatar entity={profile.selfEntity} className="size-8" />
        <span className="grid min-w-0 leading-tight">
          <strong className="truncate font-medium text-xs">{profile.selfEntity.name}</strong>
          <small className="truncate text-[0.68rem] text-muted-foreground">Your entity</small>
        </span>
      </Link>
      <Link
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        to="/settings"
        aria-label="Settings"
        title="Settings"
      >
        <Settings aria-hidden="true" />
      </Link>
      <SignOutButton />
    </footer>
  );
}
