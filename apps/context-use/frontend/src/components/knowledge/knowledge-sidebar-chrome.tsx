import { Button, buttonVariants } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { ContextUseBrand } from '@repo/ui/context-use-brand';
import { Link } from '@tanstack/react-router';
import { Menu, Settings } from 'lucide-react';
import type { KnowledgeProfile } from '../../queries/profile';
import { SignOutButton } from '../auth/sign-out-button';
import { EntityAvatar } from '../entities/entity-link';
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
      <ContextUseBrand className={cn(collapsed && 'hidden')} />
      <Button
        className={cn('size-10 shrink-0 [&_svg]:size-5', collapsed && 'size-11 shadow-lg')}
        type="button"
        variant={collapsed ? 'secondary' : 'ghost'}
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
        to="/app/entities/$id"
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
        to="/app/settings"
        aria-label="Settings"
        title="Settings"
      >
        <Settings aria-hidden="true" />
      </Link>
      <SignOutButton />
    </footer>
  );
}
