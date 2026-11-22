import { Button } from '@repo/ui/button';
import type { MouseEventHandler, ReactNode } from 'react';

type ResourceName = 'entity' | 'page' | 'asset' | 'OAuth app' | 'passkey';

type ResourceDetailActionsProps = { resource: ResourceName } & (
  | {
      mode: 'view';
      editDisabled?: boolean;
      onEdit: () => void;
      publicationActions?: ReactNode;
      children?: ReactNode;
    }
  | {
      mode: 'edit';
      saveDisabled?: boolean;
      pending: boolean;
      onCancel: () => void;
      form?: string;
      onSaveClick?: MouseEventHandler<HTMLButtonElement>;
    }
);

export function ResourceDetailActions(props: ResourceDetailActionsProps) {
  if (props.mode === 'edit') {
    return (
      <>
        <Button variant="outline" size="lg" type="button" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          size="lg"
          type="submit"
          form={props.form}
          onClick={props.onSaveClick}
          disabled={props.pending || props.saveDisabled}
        >
          {props.pending ? 'Saving…' : `Save ${props.resource}`}
        </Button>
      </>
    );
  }

  return (
    <>
      {props.publicationActions}
      <Button size="lg" type="button" disabled={props.editDisabled} onClick={props.onEdit}>
        {props.resource === 'passkey' ? 'Rename' : `Edit ${props.resource}`}
      </Button>
      {props.children}
    </>
  );
}
