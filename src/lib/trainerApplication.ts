/**
 * Coach application rules, mirrored from the API (utils/trainerApplication.js
 * and controllers/trainerController.js) so the form can validate before it
 * posts and the option list matches the mobile flow exactly.
 */

export const TRAINER_FIELDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'soccer', label: 'Soccer' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'running', label: 'Running' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'volleyball', label: 'Volleyball' },
  { value: 'baseball', label: 'Baseball' },
  { value: 'american_football', label: 'American football' },
  { value: 'golf', label: 'Golf' },
  { value: 'boxing', label: 'Boxing' },
  { value: 'martial_arts', label: 'Martial arts' },
  { value: 'weightlifting', label: 'Weightlifting' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'pilates', label: 'Pilates' },
  { value: 'crossfit', label: 'CrossFit' },
  { value: 'general_fitness', label: 'General fitness' },
  { value: 'other', label: 'Other' },
];

export const MAX_TRAINER_FIELDS = 10;
export const SUMMARY_MIN = 40;
export const SUMMARY_MAX = 2000;
export const MAX_CREDENTIAL_URLS = 5;

export type TrainerApplicationStatus = 'none' | 'pending' | 'approved' | 'rejected';

export type TrainerApplicationDraft = {
  fields: string[];
  experienceSummary: string;
  credentialUrls: string[];
};

export type TrainerApplicationErrors = Partial<Record<'fields' | 'experienceSummary' | 'credentialUrls', string>>;

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:' && value.length <= 500;
  } catch {
    return false;
  }
};

/** Split the textarea of links into a de-duplicated list. */
export function parseCredentialUrls(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean))];
}

export function validateTrainerApplication(draft: TrainerApplicationDraft): TrainerApplicationErrors {
  const errors: TrainerApplicationErrors = {};
  const known = new Set(TRAINER_FIELDS.map((f) => f.value));
  const fields = [...new Set(draft.fields)];
  if (fields.length < 1 || fields.length > MAX_TRAINER_FIELDS || fields.some((f) => !known.has(f))) {
    errors.fields = `Choose between 1 and ${MAX_TRAINER_FIELDS} specialties.`;
  }
  const summary = draft.experienceSummary.trim();
  if (summary.length < SUMMARY_MIN) {
    errors.experienceSummary = `Tell us a little more: at least ${SUMMARY_MIN} characters.`;
  } else if (summary.length > SUMMARY_MAX) {
    errors.experienceSummary = `Keep it under ${SUMMARY_MAX} characters.`;
  }
  if (draft.credentialUrls.length > MAX_CREDENTIAL_URLS) {
    errors.credentialUrls = `Up to ${MAX_CREDENTIAL_URLS} links.`;
  } else if (draft.credentialUrls.some((u) => !isHttpsUrl(u))) {
    errors.credentialUrls = 'Links must start with https://';
  }
  return errors;
}

export function statusCopy(status: TrainerApplicationStatus): { title: string; body: string } {
  switch (status) {
    case 'pending':
      return { title: 'Application under review', body: 'We usually reply within a few days. You can update and resubmit at any time.' };
    case 'approved':
      return { title: 'You are a Vybe coach', body: 'Your profile carries the Coach badge and appears in the coach directory.' };
    case 'rejected':
      return { title: 'Application not approved', body: 'Read the note below, update your details and apply again.' };
    default:
      return { title: 'Become a coach', body: 'Coaches get a badge on their profile and a place in the coach directory, where members can find and follow them.' };
  }
}
