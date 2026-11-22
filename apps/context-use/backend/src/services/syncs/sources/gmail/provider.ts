import type { SyncProvider } from '../../catalog.ts';
import { gmailThreads } from './definition.ts';
import { GMAIL_ERRORS, GMAIL_READONLY_SCOPE, GMAIL_SYNC_LABEL } from './models.ts';

export const gmailProvider = {
  id: 'gmail',
  name: 'Gmail',
  description: `Bring conversations labelled ${GMAIL_SYNC_LABEL} into Context Use.`,
  oauth: {
    createAppUrl: 'https://console.cloud.google.com/auth/clients',
    requestedScopes: [GMAIL_READONLY_SCOPE],
  },
  syncs: [
    {
      name: 'Email conversations',
      description: `Threads with the ${GMAIL_SYNC_LABEL} label.`,
      registration: gmailThreads,
      invalidCheckpointCode: GMAIL_ERRORS.resyncRequired,
      errorMessages: {
        [GMAIL_ERRORS.labelMissing]: `Create the ${GMAIL_SYNC_LABEL} label in Gmail, then resume syncing.`,
        [GMAIL_ERRORS.mailboxChanged]:
          'The connected Gmail mailbox changed. Reauthorize the original mailbox before resuming.',
      },
    },
  ],
} satisfies SyncProvider;
