export interface PreRegistrationEmailInput {
  applicantName: string;
  institutionName: string;
  reference: string;
  courseName: string;
}

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** The confirmation an applicant gets after pre-registering: their reference and what happens next. */
export function preRegistrationEmail(input: PreRegistrationEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const lines = [
    `Dear ${input.applicantName},`,
    '',
    `Thank you for your interest in ${input.courseName}. We have received your request and our staff will contact you soon.`,
    '',
    `Your reference number is ${input.reference}. Quote it if you call or visit us.`,
    '',
    input.institutionName,
  ];
  return {
    subject: `We received your request (${input.reference})`,
    text: lines.join('\n'),
    html: lines
      .map((line) => (line === '' ? '' : `<p>${esc(line)}</p>`))
      .filter(Boolean)
      .join(''),
  };
}
