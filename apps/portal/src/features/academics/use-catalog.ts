'use client';

import {
  academicYearListResponseSchema,
  courseListResponseSchema,
  holidayListResponseSchema,
  intakeListResponseSchema,
  programListResponseSchema,
  roomListResponseSchema,
  shiftListResponseSchema,
} from '@emis/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

export const usePrograms = (departmentId?: string) =>
  useQuery({
    queryKey: ['programs', departmentId ?? 'all'],
    queryFn: () =>
      apiRequest(`/programs${departmentId ? `?departmentId=${departmentId}` : ''}`, {
        schema: programListResponseSchema,
      }),
  });

export const useCourses = (programId: string) =>
  useQuery({
    queryKey: ['courses', programId],
    queryFn: () =>
      apiRequest(`/courses?programId=${programId}`, { schema: courseListResponseSchema }),
  });

export const useAcademicYears = () =>
  useQuery({
    queryKey: ['academic-years'],
    queryFn: () => apiRequest('/academic-years', { schema: academicYearListResponseSchema }),
  });

export const useIntakes = () =>
  useQuery({
    queryKey: ['intakes'],
    queryFn: () => apiRequest('/intakes', { schema: intakeListResponseSchema }),
  });

export const useHolidays = () =>
  useQuery({
    queryKey: ['holidays'],
    queryFn: () => apiRequest('/holidays', { schema: holidayListResponseSchema }),
  });

export const useShifts = () =>
  useQuery({
    queryKey: ['shifts'],
    queryFn: () => apiRequest('/shifts', { schema: shiftListResponseSchema }),
  });

export const useRooms = (branchId?: string) =>
  useQuery({
    queryKey: ['rooms', branchId ?? 'all'],
    queryFn: () =>
      apiRequest(`/rooms${branchId ? `?branchId=${branchId}` : ''}`, {
        schema: roomListResponseSchema,
      }),
  });

/** "5 May 2026" for a stored YYYY-MM-DD date, without shifting it through the browser's time zone. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).toLocaleDateString(
    undefined,
    { dateStyle: 'medium', timeZone: 'UTC' },
  );
}

export function formatDateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
}

/** An ISO instant → the value a `<input type="datetime-local">` expects (local time). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `<input type="datetime-local">` value → ISO instant, or null when empty. */
export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
