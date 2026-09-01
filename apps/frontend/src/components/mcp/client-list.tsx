import { Archive } from 'lucide-react';
import { useId, useState } from 'react';
import { useArchiveMcpClient, useRenameMcpClient } from '../../lib/hooks/use-mcp-clients';
import type { McpClient } from '../../queries/mcp-clients';
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
import { ClientNameForm } from './client-name-form';

function ClientAuthorizedAt({ client }: { client: McpClient }) {
  return (
    <p className="mt-1 text-muted-foreground text-sm">
      Authorized{' '}
      <time dateTime={client.createdAt}>{new Date(client.createdAt).toLocaleString()}</time>
    </p>
  );
}

function ClientArchiveAction({
  client,
  pending,
  onConfirm,
}: {
  client: McpClient;
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
        <AlertDialogTitle>Archive {client.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          Refresh credentials will be revoked immediately. The client must be approved again before
          it can access Context Use.
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

function ActiveClient({ client }: { client: McpClient }) {
  const rename = useRenameMcpClient();
  const archive = useArchiveMcpClient();
  const [editing, setEditing] = useState(false);
  const editFormId = useId();
  return (
    <Card>
      <CardContent className="grid gap-5">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          {editing ? (
            <ClientNameForm
              initialName={client.name}
              pending={rename.isPending}
              error={rename.error}
              formId={editFormId}
              presentation="card-title"
              onSubmit={(name) =>
                rename.mutate(
                  { clientAuthorizationId: client.id, name },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
          ) : (
            <div className="min-w-0">
              <strong>{client.name}</strong>
              <ClientAuthorizedAt client={client} />
            </div>
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
                <ClientArchiveAction
                  client={client}
                  pending={archive.isPending}
                  onConfirm={() => archive.mutate({ clientAuthorizationId: client.id })}
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

export function ClientList({ clients }: { clients: McpClient[] }) {
  const active = clients.filter((client) => client.archivedAt === null);
  const archived = clients.filter((client) => client.archivedAt !== null);
  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="font-semibold text-xl">Authenticated clients</h2>
        {active.length === 0 ? (
          <p className="text-muted-foreground">No MCP clients are authenticated.</p>
        ) : (
          active.map((client) => <ActiveClient key={client.id} client={client} />)
        )}
      </section>
      {archived.length > 0 && (
        <section className="grid gap-4">
          <h2 className="font-semibold text-xl">Archived clients</h2>
          {archived.map((client) => (
            <Card key={client.id}>
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <strong>{client.name}</strong>
                  <p className="text-muted-foreground text-sm">Credentials revoked</p>
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
