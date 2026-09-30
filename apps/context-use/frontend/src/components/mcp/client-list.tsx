import { Button } from '@repo/ui/button';
import { ShieldOff } from 'lucide-react';
import { useRevokeMcpClient } from '../../lib/hooks/use-mcp-clients';
import type { McpClient } from '../../queries/mcp-clients';
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
import { Card, CardContent } from '../ui/card';

function ClientAuthorizedAt({ client }: { client: McpClient }) {
  return (
    <p className="mt-1 text-muted-foreground text-sm">
      Authorized{' '}
      <time dateTime={client.createdAt}>{new Date(client.createdAt).toLocaleString()}</time>
    </p>
  );
}

function ClientRevokeAction({
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
            <ShieldOff data-icon="inline-start" aria-hidden="true" />
            {pending ? 'Revoking…' : 'Revoke'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogTitle>Revoke access for {client.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          Access and refresh tokens will be revoked immediately.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <AlertDialogClose
            render={
              <Button variant="destructive" onClick={onConfirm}>
                Revoke client
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ActiveClient({ client }: { client: McpClient }) {
  const revoke = useRevokeMcpClient();
  return (
    <Card>
      <CardContent className="grid gap-5">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="min-w-0">
            <strong>{client.name}</strong>
            <ClientAuthorizedAt client={client} />
          </div>
          <ClientRevokeAction
            client={client}
            pending={revoke.isPending}
            onConfirm={() => revoke.mutate({ clientAuthorizationId: client.id })}
          />
        </div>
        {revoke.error && (
          <p className="text-destructive text-sm" role="alert">
            {revoke.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ClientList({ clients }: { clients: McpClient[] }) {
  const active = clients.filter((client) => client.archivedAt === null);
  const revoked = clients.filter((client) => client.archivedAt !== null);
  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="font-semibold text-xl">Authorized clients</h2>
        {active.length === 0 ? (
          <p className="text-muted-foreground">No MCP clients are authorized.</p>
        ) : (
          active.map((client) => <ActiveClient key={client.id} client={client} />)
        )}
      </section>
      {revoked.length > 0 && (
        <section className="grid gap-4">
          <h2 className="font-semibold text-xl">Revoked clients</h2>
          {revoked.map((client) => (
            <Card key={client.id}>
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <strong>{client.name}</strong>
                  <p className="text-muted-foreground text-sm">Credentials revoked</p>
                </div>
                <Badge variant="secondary">Revoked</Badge>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
