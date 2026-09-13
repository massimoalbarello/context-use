import { useForm } from '@tanstack/react-form';
import { submitThenChangeValidation } from '../../lib/form-validation';
import type { FaceSettings, ThresholdInput } from '../../queries/faces';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';

const THRESHOLD_STEP = 0.001;

export function FaceSettingsForm({
  settings,
  pending,
  error,
  onSave,
}: {
  settings: FaceSettings;
  pending: boolean;
  error: Error | null;
  onSave: (input: ThresholdInput) => void;
}) {
  const form = useForm({
    defaultValues: { threshold: String(settings.threshold) },
    validationLogic: submitThenChangeValidation,
    onSubmitMeta: { rematch: false },
    onSubmit: ({ value, meta }) => {
      onSave({
        threshold: Number(value.threshold),
        rematch: meta.rematch,
        analysisVersion: settings.model.analysisVersion,
      });
    },
  });
  return (
    <form
      noValidate
      className="grid max-w-2xl gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="threshold"
        validators={{
          onDynamic: ({ value }) =>
            value.trim() !== '' &&
            Number.isFinite(Number(value)) &&
            Number(value) >= -1 &&
            Number(value) <= 1
              ? undefined
              : 'Enter a threshold between -1 and 1.',
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor="face-threshold">Match threshold</FieldLabel>
            <FieldDescription>
              Choose how similar a face must be to a person’s reference image before it is matched.
            </FieldDescription>
            <div className="mt-3 grid grid-cols-[1fr_7rem] items-center gap-6">
              <Slider
                min={-1}
                max={1}
                step={THRESHOLD_STEP}
                value={
                  field.state.value !== '' && Number.isFinite(Number(field.state.value))
                    ? Number(field.state.value)
                    : settings.threshold
                }
                label="Match strictness"
                disabled={pending}
                onValueChange={(value) => field.handleChange(String(value))}
              />
              <Input
                id="face-threshold"
                aria-invalid={field.state.meta.errors.length > 0}
                type="text"
                inputMode="decimal"
                required
                value={field.state.value}
                disabled={pending}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </div>
            <FieldError>{field.state.meta.errors[0]}</FieldError>
            <div className="flex justify-between text-muted-foreground text-xs">
              <span>Looser · more matches</span>
              <span>Stricter · fewer matches</span>
            </div>
            <p className="mt-2 text-muted-foreground text-sm">
              Default: <strong>{settings.model.defaultThreshold}</strong>. Higher values require a
              closer match.
            </p>
          </Field>
        )}
      </form.Field>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Saving affects subsequent matches. Re-matching also updates existing automatic assignments.
        Confirmed identities, corrections, and faces you leave unidentified stay fixed.
      </p>
      {error && <FieldError>{error.message}</FieldError>}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          type="button"
          disabled={pending}
          onClick={() => void form.handleSubmit({ rematch: true })}
        >
          Save &amp; re-match
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save threshold'}
        </Button>
      </div>
    </form>
  );
}
