import { useSuspenseQuery } from '@tanstack/react-query';
import {
  useArchiveMcpConnection,
  useRenameMcpConnection,
} from '../../lib/hooks/use-mcp-connections';
import { type McpConnection, mcpConnectionsQueryOptions } from '../../queries/mcp-connections';
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

function ActiveConnection({ connection }: { connection: McpConnection }) {
  const rename = useRenameMcpConnection();
  const archive = useArchiveMcpConnection();
  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <strong>{connection.name}</strong>
            <p className="mt-1 text-muted-foreground text-sm">
              {connection.verifiedClientId ? 'Verified client identity' : 'Registered OAuth client'}
            </p>
          </div>
          <Badge variant="outline">Active</Badge>
        </div>
        <ConnectionNameForm
          initialName={connection.name}
          pending={rename.isPending}
          error={rename.error}
          submitLabel="Rename"
          onSubmit={(name) => rename.mutate({ connectionId: connection.id, name })}
          secondaryAction={
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" type="button" />}>
                Archive connection
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Archive {connection.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Refresh credentials will be revoked immediately. The client must be approved as a
                  new connection before it can access Context Use again.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                  <AlertDialogClose
                    render={<Button variant="destructive" disabled={archive.isPending} />}
                    onClick={() => archive.mutate({ connectionId: connection.id })}
                  >
                    Archive connection
                  </AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
        {archive.error && (
          <p className="text-destructive text-sm" role="alert">
            {archive.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectionList() {
  const { data } = useSuspenseQuery(mcpConnectionsQueryOptions);
  const active = data.items.filter((connection) => connection.archivedAt === null);
  const archived = data.items.filter((connection) => connection.archivedAt !== null);
  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="font-semibold text-xl">Active</h2>
        {active.length === 0 ? (
          <p className="text-muted-foreground">No MCP clients have been approved.</p>
        ) : (
          active.map((connection) => (
            <ActiveConnection key={connection.id} connection={connection} />
          ))
        )}
      </section>
      {archived.length > 0 && (
        <section className="grid gap-4">
          <h2 className="font-semibold text-xl">Archived</h2>
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
