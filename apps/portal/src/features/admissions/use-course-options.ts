'use client';

import { courseListResponseSchema } from '@emis/contracts';
import { useQueries } from '@tanstack/react-query';

import { usePrograms } from '@/features/academics/use-catalog';
import { apiRequest } from '@/lib/api';

export interface CourseOption {
  id: string;
  label: string;
}

/** Every active course as "Program · Course", for choosing a desired course or a placement level. */
export function useCourseOptions(): { options: CourseOption[]; loading: boolean } {
  const programs = usePrograms();
  const lists = useQueries({
    queries: (programs.data?.items ?? []).map((program) => ({
      queryKey: ['courses', program.id],
      queryFn: () =>
        apiRequest(`/courses?programId=${program.id}`, { schema: courseListResponseSchema }),
    })),
  });

  const options = (programs.data?.items ?? []).flatMap((program, i) =>
    (lists[i]?.data?.items ?? [])
      .filter((course) => course.isActive)
      .map((course) => ({ id: course.id, label: `${program.name} · ${course.name}` })),
  );
  return { options, loading: programs.isPending || lists.some((l) => l.isPending) };
}
