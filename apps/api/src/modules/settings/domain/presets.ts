import type { SetupPreset } from '@emis/contracts';

/**
 * Starting packs for the setup wizard. Each gives the departments for a kind of institution;
 * pick any combination, then rename or add your own. (Catalog presets, e.g. CEFR levels, join these
 * when programs and courses land.)
 */
export const PRESETS: readonly SetupPreset[] = [
  {
    key: 'language',
    name: 'Language school',
    description: 'General language courses by level, plus exam preparation.',
    departments: [
      {
        code: 'LANG',
        name: 'Language',
        description: 'Language courses from beginner to advanced, and exam preparation.',
      },
    ],
  },
  {
    key: 'computer',
    name: 'Computer training',
    description: 'Office skills, programming, web development and design.',
    departments: [
      {
        code: 'COMP',
        name: 'Computer',
        description: 'Practical computer courses, from office basics to programming.',
      },
    ],
  },
  {
    key: 'tutoring',
    name: 'Tutoring center',
    description: 'School subject tutoring and national exam preparation.',
    departments: [
      {
        code: 'TUTOR',
        name: 'Tutoring',
        description: 'Subject tutoring for school students and exam preparation.',
      },
    ],
  },
];

export function findPreset(key: string): SetupPreset | undefined {
  return PRESETS.find((preset) => preset.key === key);
}
