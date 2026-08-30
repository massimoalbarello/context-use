import { expect, test } from 'bun:test';
import { FieldApi, FormApi } from '@tanstack/react-form';
import { submitThenChangeValidation } from '../../src/lib/form-validation';

test('required fields stay quiet until submit and then revalidate while editing', async () => {
  const form = new FormApi({
    defaultValues: { name: '' },
    validationLogic: submitThenChangeValidation,
    onSubmit: () => undefined,
  });
  const field = new FieldApi({
    form,
    name: 'name',
    validators: { onDynamic: ({ value }) => (value ? undefined : 'Required') },
  });
  const unmountForm = form.mount();
  const unmountField = field.mount();

  try {
    expect(field.state.meta.errors).toEqual([]);

    await form.handleSubmit();
    expect(field.state.meta.errors).toEqual(['Required']);

    field.handleChange('Ada');
    expect(field.state.meta.errors).toEqual([]);
  } finally {
    unmountField();
    unmountForm();
  }
});
