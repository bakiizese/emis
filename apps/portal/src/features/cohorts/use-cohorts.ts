'use client';

import {
  type CohortStatus,
  classSessionListResponseSchema,
  cohortSchema,
  enrollmentListResponseSchema,
  instructorListResponseSchema,
} from '@emis/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

export const useCohort = (id: string) =>
  useQuery({
    queryKey: ['cohorts', 'one', id],
    queryFn: () => apiRequest(`/cohorts/${id}`, { schema: cohortSchema }),
  });

export const useCohortSessions = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['cohorts', id, 'sessions'],
    queryFn: () =>
      apiRequest(`/cohorts/${id}/sessions`, { schema: classSessionListResponseSchema }),
    enabled,
  });

export const useRoster = (cohortId: string) =>
  useQuery({
    queryKey: ['enrollments', 'cohort', cohortId],
    queryFn: () =>
      apiRequest(`/enrollments?cohortId=${cohortId}&limit=200`, {
        schema: enrollmentListResponseSchema,
      }),
  });

export const useStudentEnrollments = (studentId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['enrollments', 'student', studentId],
    queryFn: () =>
      apiRequest(`/enrollments?studentId=${studentId}&limit=100`, {
        schema: enrollmentListResponseSchema,
      }),
    enabled,
  });

export const useInstructors = () =>
  useQuery({
    queryKey: ['cohorts', 'instructors'],
    queryFn: () => apiRequest('/cohorts/instructors', { schema: instructorListResponseSchema }),
  });

export const COHORT_ACTIONS: Record<
  CohortStatus,
  { label: string; variant: 'primary' | 'secondary' | 'ghost'; confirm?: string }[]
> = {
  planned: [
    { label: 'Open for enrollment', variant: 'primary' },
    {
      label: 'Cancel cohort',
      variant: 'ghost',
      confirm: 'Cancel this cohort? Its room and instructor become free.',
    },
  ],
  open: [
    { label: 'Start classes', variant: 'primary' },
    { label: 'Back to planned', variant: 'secondary' },
    {
      label: 'Cancel cohort',
      variant: 'ghost',
      confirm: 'Cancel this cohort? Its room and instructor become free.',
    },
  ],
  running: [{ label: 'Finish cohort', variant: 'primary', confirm: 'Finish this cohort?' }],
  completed: [],
  cancelled: [],
};

/** The status each action button leads to, by position in COHORT_ACTIONS. */
export const ACTION_TARGETS: Record<CohortStatus, CohortStatus[]> = {
  planned: ['open', 'cancelled'],
  open: ['running', 'planned', 'cancelled'],
  running: ['completed'],
  completed: [],
  cancelled: [],
};
