import { Archive } from 'lucide-react';
import { useId, useState } from 'react';
import {
  useArchiveMcpConnection,
  useRenameMcpConnection,
} from '../../lib/hooks/use-mcp-connections';
import type { McpConnection } from '../../queries/mcp-connections';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ConnectionNameForm } from './connection-name-form';

function ConnectionArchiveAction({
  connection,
  pending,
  onConfirm,
}: {
  connection: McpConnection;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="destructive" size="lg" type="button" disabled={pending}>
            <Archive data-icon="inline-start" aria-hidden="true" />
            {pending ? 'Archiving…' : 'Archive'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogTitle>Archive {connection.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          Refresh credentials will be revoked immediately. The client must be approved as a new
          connection before it can access Context Use again.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <AlertDialogClose
            render={
              <Button variant="destructive" onClick={onConfirm}>
                Archive client
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ActiveConnection({ connection }: { connection: McpConnection }) {
  const rename = useRenameMcpConnection();
  const archive = useArchiveMcpConnection();
  const [editing, setEditing] = useState(false);
  const editFormId = useId();
  return (
    <Card>
      <CardContent className="grid gap-5">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          {editing ? (
            <ConnectionNameForm
              initialName={connection.name}
              pending={rename.isPending}
              error={rename.error}
              formId={editFormId}
              presentation="card-title"
              onSubmit={(name) =>
                rename.mutate(
                  { connectionId: connection.id, name },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
          ) : (
            <strong className="min-w-0">{connection.name}</strong>
          )}
          <div className="flex shrink-0 flex-wrap gap-2">
            {editing ? (
              <ResourceDetailActions
                mode="edit"
                resource="client"
                form={editFormId}
                pending={rename.isPending}
                onCancel={() => {
                  rename.reset();
                  setEditing(false);
                }}
              />
            ) : (
              <ResourceDetailActions
                mode="view"
                resource="client"
                onEdit={() => {
                  rename.reset();
                  setEditing(true);
                }}
              >
                <ConnectionArchiveAction
                  connection={connection}
                  pending={archive.isPending}
                  onConfirm={() => archive.mutate({ connectionId: connection.id })}
                />
              </ResourceDetailActions>
            )}
          </div>
        </div>
        {archive.error && (
          <p className="text-destructive text-sm" role="alert">
            {archive.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectionList({ connections }: { connections: McpConnection[] }) {
  const active = connections.filter((connection) => connection.archivedAt === null);
  const archived = connections.filter((connection) => connection.archivedAt !== null);
  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="font-semibold text-xl">Authenticated clients</h2>
        {active.length === 0 ? (
          <p className="text-muted-foreground">No MCP clients are authenticated.</p>
        ) : (
          active.map((connection) => (
            <ActiveConnection key={connection.id} connection={connection} />
          ))
        )}
      </section>
      {archived.length > 0 && (
        <section className="grid gap-4">
          <h2 className="font-semibold text-xl">Archived clients</h2>
          {archived.map((connection) => (
            <Card key={connection.id}>
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <strong>{connection.name}</strong>
                  <p className="mt-1 text-muted-foreground text-sm">Credentials revoked</p>
                </div>
                <Badge variant="secondary">Archived</Badge>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
