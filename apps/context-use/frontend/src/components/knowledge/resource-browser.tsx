import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useNarrowWorkspace } from '../../lib/hooks/use-narrow-workspace';
import {
  type ResourceSelection,
  resourceSearch,
  selectedResource,
} from '../../lib/resource-selection';
import { AssetDetail } from '../assets/asset-detail';
import { EntityDetail } from '../entities/entity-detail';
import { KnowledgePageDetail } from '../pages/page-detail';
import { RecordDetail } from '../records/record-detail';
import { useKnowledgeWorkspace } from './knowledge-workspace';
import { ResourceNavigation } from './resource-navigation';
import { ResourcePreviewPanel } from './resource-preview-panel';

function focusExpandedResource(element: HTMLElement | null) {
  element?.focus({ preventScroll: true });
}

export function ResourceBrowser({
  children,
  toolbar,
  from,
}: {
  children: ReactNode;
  toolbar?: ReactNode;
  from: '/hypermedia' | '/entities' | '/pages' | '/assets' | '/records';
}) {
  const narrow = useNarrowWorkspace();
  const { collapsed } = useKnowledgeWorkspace();
  const search = useSearch({ strict: false });
  const state = resourceSearch(search);
  const selection = selectedResource(state);
  const navigate = useNavigate({ from });
  const browsing = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  function select(next: ResourceSelection) {
    if (!selection) {
      origin.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    void navigate({
      search: (previous) => ({
        ...previous,
        resource: next.kind,
        resourceId: next.readableId,
        expanded: narrow || undefined,
        view: undefined,
      }),
      hash: next.fragment,
      resetScroll: false,
    });
  }
  function close() {
    void navigate({
      search: (previous) => ({
        ...previous,
        resource: undefined,
        resourceId: undefined,
        expanded: undefined,
        view: undefined,
      }),
      hash: '',
      resetScroll: false,
    }).then(() =>
      (origin.current?.isConnected ? origin.current : browsing.current)?.focus({
        preventScroll: true,
      }),
    );
  }
  function changeView({
    view,
    hash,
  }: {
    view: 'preview' | 'links' | 'revisions' | 'metadata';
    hash?: string;
  }) {
    void navigate({ search: (previous) => ({ ...previous, view }), hash, resetScroll: false });
  }
  const expanded = Boolean(selection && (state.expanded || narrow));
  return (
    <ResourceNavigation value={{ selection, onSelect: select }}>
      <div className="flex size-full min-h-0 flex-col overflow-clip">
        <div className="shrink-0" hidden={expanded}>
          {toolbar}
        </div>
        <div className="relative min-h-0 flex-1 overflow-clip">
          <div
            className={cn('size-full', expanded && 'hidden')}
            aria-hidden={expanded || undefined}
            ref={browsing}
            tabIndex={-1}
          >
            {children}
          </div>
          {selection &&
            (expanded ? (
              <section
                className="absolute inset-0 flex min-h-0 flex-col overflow-clip"
                aria-label="Expanded resource"
                tabIndex={-1}
                ref={focusExpandedResource}
              >
                <div className={cn('shrink-0 border-b px-5 py-3', collapsed && 'pl-20')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (narrow) {
                        close();
                      } else {
                        void navigate({
                          search: (previous) => ({ ...previous, expanded: undefined }),
                          resetScroll: false,
                        });
                      }
                    }}
                  >
                    <ArrowLeft aria-hidden="true" />
                    Back to browsing
                  </Button>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                  key={`${selection.kind}:${selection.readableId}`}
                >
                  {selection.kind === 'entity' && (
                    <EntityDetail id={selection.readableId} onArchived={close} />
                  )}
                  {selection.kind === 'page' && (
                    <KnowledgePageDetail
                      id={selection.readableId}
                      view={state.view === 'metadata' ? undefined : state.view}
                      onViewChange={changeView}
                      onArchived={close}
                    />
                  )}
                  {selection.kind === 'asset' && (
                    <AssetDetail id={selection.readableId} onArchived={close} />
                  )}
                  {selection.kind === 'record' && (
                    <RecordDetail
                      id={selection.readableId}
                      view={state.view === 'revisions' ? undefined : state.view}
                      onViewChange={changeView}
                    />
                  )}
                </div>
              </section>
            ) : (
              <ResourcePreviewPanel
                selection={selection}
                onSelect={select}
                onClose={close}
                onExpand={() => {
                  void navigate({
                    search: (previous) => ({ ...previous, expanded: true }),
                    resetScroll: false,
                  });
                }}
              />
            ))}
        </div>
      </div>
    </ResourceNavigation>
  );
}
