import { preRegistrationRequestSchema, type PublicClass } from '@emis/contracts';

/** What to say when a field is missing or malformed (the schema's own wording is for developers). */
const FIELD_MESSAGES: Record<string, string> = {
  givenName: 'Enter your first name.',
  fatherName: "Enter your father's name.",
  grandfatherName: 'This name is too long.',
  gender: 'Choose one.',
  dateOfBirth: 'Enter a valid date of birth.',
  phone: 'Enter a valid phone number, e.g. 0911 22 33 44.',
  email: 'Enter a valid email address.',
  city: 'This is too long.',
  branchId: 'Choose a branch.',
  desiredCourseId: 'Choose a course.',
  guardianName: "Enter the guardian's full name.",
  guardianPhone: 'Enter a valid phone number for the guardian.',
  message: 'Keep this under 500 characters.',
  consent: 'Please tick this box to continue.',
};

/** Field → message for whatever is wrong with the form, or null when it can be sent. */
export function validatePreRegistration(body: unknown): Record<string, string> | null {
  const parsed = preRegistrationRequestSchema.safeParse(body);
  if (parsed.success) return null;
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? '');
    errors[field] ??=
      issue.code === 'custom' && field !== 'consent'
        ? issue.message
        : (FIELD_MESSAGES[field] ?? issue.message);
  }
  return errors;
}

/**
 * The intake to attach to a request: the one the person's chosen class belongs to. With no shift
 * or branch picked, any class of that course will do; with none matching, no intake.
 */
export function intakeFor(
  classes: readonly PublicClass[],
  choice: { courseId: string; shiftId: string; branchId: string },
): string | null {
  const match = classes.find(
    (c) =>
      c.courseId === choice.courseId &&
      (!choice.shiftId || c.shift.id === choice.shiftId) &&
      (!choice.branchId || c.branch.id === choice.branchId),
  );
  return match?.intakeId ?? null;
}
