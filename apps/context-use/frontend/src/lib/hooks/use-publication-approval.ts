import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { assetSuggestionsQueryKey, assetsListQueryKey } from '../../queries/assets';
import { entitiesListQueryKey } from '../../queries/entities';
import { knowledgeSuggestionsQueryKey } from '../../queries/knowledge-suggestions';
import { pagesListQueryKey } from '../../queries/pages';
import {
  beginPublication,
  type CompletePublicationVariables,
  completePublication,
  type PublicationRequest,
  publicationsQueryKey,
} from '../../queries/publications';
import { recordsListQueryKey } from '../../queries/records';
import { passkeyErrorMessage } from '../passkey-error';

export function usePublicationApproval() {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<PublicationRequest | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [ceremonyError, setCeremonyError] = useState<string | null>(null);
  const [expiredApprovalId, setExpiredApprovalId] = useState<string | null>(null);
  const sequence = useRef(0);
  const ceremony = useRef(false);
  const busy = useRef(false);
  const preparation = useMutation({ mutationFn: beginPublication, retry: false });
  const completion = useMutation({
    mutationFn: (variables: CompletePublicationVariables & { request: PublicationRequest }) =>
      completePublication(variables),
    retry: false,
    onSettled: async (...[_data, _error, { request }]) => {
      const listKeys =
        request.resourceType === 'page'
          ? [pagesListQueryKey]
          : request.resourceType === 'entity'
            ? [entitiesListQueryKey, assetsListQueryKey, assetSuggestionsQueryKey]
            : request.resourceType === 'record'
              ? [recordsListQueryKey]
              : [assetsListQueryKey, assetSuggestionsQueryKey];
      await Promise.all(
        [publicationsQueryKey, ...listKeys, knowledgeSuggestionsQueryKey].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
  const ready = preparation.data;

  useEffect(() => {
    if (!ready) {
      return;
    }
    const timeout = setTimeout(
      () => setExpiredApprovalId(ready.approvalId),
      Math.max(0, Date.parse(ready.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [ready]);

  useEffect(() => {
    return () => {
      sequence.current += 1;
      if (ceremony.current) {
        ceremony.current = false;
        WebAuthnAbortService.cancelCeremony();
      }
    };
  }, []);

  function close() {
    sequence.current += 1;
    if (ceremony.current) {
      ceremony.current = false;
      WebAuthnAbortService.cancelCeremony();
    }
    busy.current = false;
    setAuthenticating(false);
    setRequest(null);
    preparation.reset();
    completion.reset();
    setCeremonyError(null);
  }

  function review(selected: PublicationRequest) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    const current = ++sequence.current;
    setRequest(selected);
    preparation.reset();
    completion.reset();
    setCeremonyError(null);
    preparation.mutate(selected, {
      onSettled: () => {
        if (sequence.current === current) {
          busy.current = false;
        }
      },
    });
  }

  const expired = ready?.approvalId === expiredApprovalId;
  const needsReview = expired || !!preparation.error || !!completion.error || !!ceremonyError;

  async function confirm() {
    if (!ready || !request || needsReview || busy.current) {
      return;
    }
    if (Date.parse(ready.expiresAt) <= Date.now()) {
      setExpiredApprovalId(ready.approvalId);
      return;
    }
    busy.current = true;
    ceremony.current = true;
    setAuthenticating(true);
    const current = sequence.current;
    const assertion = await startAuthentication({ optionsJSON: ready.options }).catch((error) => {
      if (sequence.current === current) {
        setCeremonyError(
          passkeyErrorMessage({
            error: error instanceof Error ? error : {},
            fallback: 'Passkey verification did not finish. Review the operation again to retry.',
          }),
        );
      }
      return null;
    });
    if (sequence.current !== current) {
      return;
    }
    ceremony.current = false;
    setAuthenticating(false);
    if (assertion) {
      await completion
        .mutateAsync({ approvalId: ready.approvalId, assertion, request })
        .then(() => {
          if (sequence.current === current) {
            close();
          }
        })
        .catch(() => undefined);
    }
    if (sequence.current === current) {
      busy.current = false;
    }
  }

  return {
    request,
    ready,
    preparing: preparation.isPending,
    authenticating,
    completing: completion.isPending,
    error: completion.error ?? preparation.error,
    ceremonyError,
    expired,
    needsReview,
    review,
    confirm,
    close,
  };
}
