import type { ReactNode } from 'react';
import { Button } from '../ui/button';

type ResourceName = 'entity' | 'page' | 'asset' | 'client';

type ResourceDetailActionsProps = { resource: ResourceName } & (
  | {
      mode: 'view';
      onEdit: () => void;
      children?: ReactNode;
    }
  | {
      mode: 'edit';
      pending: boolean;
      onCancel: () => void;
      form?: string;
    }
);

export function ResourceDetailActions(props: ResourceDetailActionsProps) {
  if (props.mode === 'edit') {
    return (
      <>
        <Button variant="outline" size="lg" type="button" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button size="lg" type="submit" form={props.form} disabled={props.pending}>
          {props.pending ? 'Saving…' : `Save ${props.resource}`}
        </Button>
      </>
    );
  }

  return (
    <>
      <Button size="lg" type="button" onClick={props.onEdit}>
        Edit {props.resource}
      </Button>
      {props.children}
    </>
  );
}
