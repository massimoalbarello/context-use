import { Button } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { isEmbeddableAssetMedia } from '#backend/models/assets/media.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_MEBIBYTES } from '#backend/models/assets/model.ts';
import {
  type EntityType,
  MAX_ENTITY_DESCRIPTION_LENGTH,
  MAX_ENTITY_NAME_LENGTH,
} from '#backend/models/entities/model.ts';
import { DuplicateResourceNameError } from '../../lib/api-error';
import { submitThenChangeValidation } from '../../lib/form-validation';
import type { AssetSummary } from '../../queries/assets';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { EntityTypeField } from './entity-type-field';
import { validateEntityDescription, validateEntityName } from './entity-validation';

export type EntityFormValues = {
  name: string;
  description: string;
  entityType: EntityType | null;
  image: File | AssetSummary | null;
};

export type EntityImageInputProps = {
  value: EntityFormValues['image'];
  pending: boolean;
  onChange: (value: EntityFormValues['image']) => void;
};

export type EntityFormSubmission = EntityFormValues & { allowDuplicate?: boolean };

export function EntityForm({
  initialValues,
  pending,
  error,
  submitLabel,
  entityTypeReadOnly = false,
  identitySaved = false,
  renderImageInput,
  onSubmit,
}: {
  initialValues: EntityFormValues;
  pending: boolean;
  error: Error | null;
  submitLabel: string;
  entityTypeReadOnly?: boolean;
  identitySaved?: boolean;
  renderImageInput: (props: EntityImageInputProps) => ReactNode;
  onSubmit: (values: EntityFormSubmission) => void;
}) {
  const form = useForm({
    defaultValues: { ...initialValues, allowDuplicate: false },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      onSubmit({
        name: value.name.trim(),
        description: value.description.trim(),
        entityType: value.entityType,
        image: value.image,
        allowDuplicate: value.allowDuplicate || undefined,
      });
    },
  });
  const duplicateName = error instanceof DuplicateResourceNameError;

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) {
          return;
        }
        form.setFieldValue('allowDuplicate', false);
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={pending || identitySaved}>
        <FieldGroup>
          <form.Field name="name" validators={{ onDynamic: validateEntityName }}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="entity-name">Name</FieldLabel>
                <Input
                  id="entity-name"
                  name={field.name}
                  value={field.state.value}
                  maxLength={MAX_ENTITY_NAME_LENGTH}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError>{field.state.meta.errors[0]}</FieldError>
              </Field>
            )}
          </form.Field>

          <form.Field
            name="description"
            validators={{
              onDynamic: validateEntityDescription,
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="entity-description">Distinguishing description</FieldLabel>
                <Textarea
                  id="entity-description"
                  className="resize-y leading-relaxed"
                  name={field.name}
                  rows={4}
                  maxLength={MAX_ENTITY_DESCRIPTION_LENGTH}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldDescription>
                  A few sentences at most: enough to tell this entity from namesakes.
                </FieldDescription>
                <FieldError>{field.state.meta.errors[0]}</FieldError>
              </Field>
            )}
          </form.Field>
          <form.Field name="entityType">
            {(field) => (
              <EntityTypeField
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                readOnly={entityTypeReadOnly || pending || identitySaved}
              />
            )}
          </form.Field>
        </FieldGroup>
      </fieldset>
      <form.Field
        name="image"
        validators={{
          onDynamic: ({ value }) => {
            if (!(value instanceof File)) {
              return undefined;
            }
            if (value.size > MAX_ASSET_BYTES) {
              return `Images can be at most ${MAX_ASSET_MEBIBYTES} MB.`;
            }
            if (!isEmbeddableAssetMedia(value.type)) {
              return 'Choose a PNG, JPEG, GIF, or WebP image.';
            }
            return undefined;
          },
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            {renderImageInput({ value: field.state.value, pending, onChange: field.handleChange })}
            <FieldError>{field.state.meta.errors[0]}</FieldError>
          </Field>
        )}
      </form.Field>
      {identitySaved && !pending && (
        <FieldDescription>
          The entity has been created. Retry saving its image, choose another, or remove it to
          continue without an image.
        </FieldDescription>
      )}

      {error && <FieldError>{error.message}</FieldError>}

      <div className="flex flex-wrap items-center gap-3">
        <Button className="justify-self-start" size="lg" type="submit" disabled={pending}>
          {pending ? 'Saving…' : identitySaved ? 'Continue' : submitLabel}
        </Button>
        {duplicateName && (
          <Button
            variant="outline"
            type="button"
            disabled={pending}
            onClick={() => {
              form.setFieldValue('allowDuplicate', true);
              void form.handleSubmit();
            }}
          >
            Use this name anyway
          </Button>
        )}
      </div>
    </form>
  );
}
