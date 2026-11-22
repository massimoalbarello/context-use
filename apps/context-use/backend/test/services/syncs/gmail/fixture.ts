import type { ProviderOperations, ProviderResponse } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { unused } from '../engine-fixture.ts';

export const account = 'owner@example.com';
export const initialHistory = '9007199254740993000';
export const completedHistory = '9007199254740993010';
export const sentAt = '2026-11-01T09:00:00.000Z';
export function message(input: {
  id: string;
  text: string;
  labels?: string[];
  subject?: string;
  date?: string;
  html?: string;
}): JsonObject {
  const text = {
    partId: '0',
    mimeType: input.html ? 'text/html' : 'text/plain',
    body: { data: Buffer.from(input.html ?? input.text).toString('base64url') },
  };
  return {
    id: input.id,
    threadId: 'thread-one',
    internalDate: String(Date.parse(input.date ?? sentAt)),
    labelIds: input.labels ?? ['Label_context'],
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: input.subject ?? 'Quarterly invoice' },
        { name: 'From', value: 'Alex <alex@example.com>' },
        { name: 'To', value: account },
        { name: 'TO', value: '"Smith, Pat"\r\n <pat@example.com>' },
        { name: 'Cc', value: 'finance@example.com' },
        { name: 'Bcc', value: 'hidden@example.com' },
      ],
      parts: [text],
    },
  };
}
export function attachedMessage(subject?: string): JsonObject {
  const msg = message({ id: 'message-one', text: 'Amount due: £120.50', subject });
  const payload = msg.payload as JsonObject;
  return {
    ...msg,
    payload: {
      ...payload,
      parts: [
        {
          partId: '0',
          mimeType: 'text/html',
          body: {
            data: Buffer.from(
              '<h1>Invoice</h1><table><tr><th>Item</th><th>Total</th></tr><tr><td>Services</td><td>£120.50</td></tr></table><img src="cid:chart" alt="Revenue">',
            ).toString('base64url'),
          },
        },
        {
          partId: '1',
          mimeType: 'multipart/related',
          parts: [
            {
              partId: '1.0',
              mimeType: 'image/png',
              headers: [{ name: 'Content-ID', value: '<chart>' }],
              body: {
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8_x8AAwMCAO_8lWQAAAAASUVORK5CYII',
              },
            },
            {
              partId: '1.1',
              mimeType: 'application/pdf',
              filename: 'invoice.pdf',
              body: { attachmentId: 'invoice-bytes', data: '' },
            },
          ],
        },
      ],
    },
  };
}
export function gmailFixture() {
  const requests: { path: string; query: JsonObject }[] = [];
  const downloads: string[] = [];
  let mailbox = account;
  let label = 'Label_context';
  let history = initialHistory;
  let thread: JsonObject = {
    id: 'thread-one',
    historyId: initialHistory,
    messages: [message({ id: 'message-one', text: 'Amount due: £120.50' })],
  };
  let historyPages: JsonObject[] = [{ historyId: completedHistory }];
  let listings: JsonObject[] = [
    { threads: [{ id: 'thread-one' }], nextPageToken: '1' },
    { threads: [], nextPageToken: '2' },
    { threads: [{ id: 'thread-one' }] },
  ];
  let intercept:
    | ((input: { path: string; query: JsonObject }) => Promise<ProviderResponse> | undefined)
    | undefined;
  let downloadError: Error | undefined;
  const reply = (body: JsonObject): Promise<ProviderResponse> =>
    Promise.resolve({ status: 200, headers: {}, body });
  const provider: ProviderOperations = {
    action: unused,
    post: unused,
    download(input) {
      downloads.push(String(input.input.attachmentId));
      return downloadError
        ? Promise.reject(downloadError)
        : Promise.resolve(new Blob(['Attachment bytes']).stream());
    },
    get({ path, query = {} }) {
      requests.push({ path, query });
      const injected = intercept?.({ path, query });
      if (injected) {
        return injected;
      }
      const pageIndex = Number(query.pageToken ?? 0);
      const responses: Record<string, () => JsonObject> = {
        '/users/me/profile': () => ({ emailAddress: mailbox, historyId: history }),
        '/users/me/labels': () => ({ labels: label ? [{ id: label, name: 'context-use' }] : [] }),
        '/users/me/threads': () => listings[pageIndex]!,
        '/users/me/history': () => historyPages[pageIndex]!,
        '/users/me/threads/thread-one': () => thread,
      };
      const response = responses[path];
      if (response) {
        return reply(response());
      }
      return unused();
    },
  };
  return {
    requests,
    downloads,
    provider,
    reply,
    get thread() {
      return thread;
    },
    set thread(value: JsonObject) {
      thread = value;
    },
    set account(value: string) {
      mailbox = value;
    },
    set label(value: string) {
      label = value;
    },
    set history(value: string) {
      history = value;
    },
    set historyPages(value: JsonObject[]) {
      historyPages = value;
    },
    set listings(value: JsonObject[]) {
      listings = value;
    },
    set intercept(value: typeof intercept) {
      intercept = value;
    },
    set downloadError(value: Error | undefined) {
      downloadError = value;
    },
  };
}
