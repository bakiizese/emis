'use client';

import { STUDENT_STATUSES, studentListResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Input } from '@emis/ui/components/input';
import { SelectField } from '@emis/ui/components/select';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useBranches } from '@/features/institution/use-org-units';
import { useInstitution } from '@/features/institution/use-institution';
import { StudentStatusBadge, studentStatusLabel } from '@/features/people/status-badges';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';

import { StudentForm } from './student-form';

export function StudentsScreen() {
  const router = useRouter();
  const { term } = useInstitution();
  const { can } = useSession();
  const branches = useBranches();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [registering, setRegistering] = useState(false);

  const students = useInfiniteQuery({
    queryKey: ['students', q, status, branchId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: '25',
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
        ...(branchId ? { branchId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiRequest(`/students?${params.toString()}`, { schema: studentListResponseSchema });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const rows = students.data?.pages.flatMap((page) => page.items) ?? [];
  const branchName = (id: string) => branches.data?.items.find((b) => b.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <SectionHeader
        title={term('student', true)}
        description="Everyone registered here. Search by name, student number or phone."
        action={
          !registering ? (
            <div className="flex gap-2">
              {can('students.import') ? (
                <Link
                  href="/students/import"
                  className="border-border hover:bg-secondary inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium"
                >
                  Import from CSV
                </Link>
              ) : null}
              {can('students.manage') ? (
                <Button onClick={() => setRegistering(true)}>
                  Register {term('student').toLowerCase()}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      {registering ? (
        <StudentForm
          onDone={(id) => {
            setRegistering(false);
            if (id) router.push(`/students/${id}`);
          }}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
        <Input
          type="search"
          placeholder="Search by name, number or phone"
          aria-label="Search students"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Any status</option>
          {STUDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {studentStatusLabel(s)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={term('branch')}
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
        >
          <option value="">All</option>
          {branches.data?.items.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
      </div>
      {students.error ? <Alert tone="error">{errorMessage(students.error)}</Alert> : null}
      <SimpleTable
        head={[term('student'), 'Number', 'Phone', term('branch'), 'Status']}
        empty={
          !students.isPending && rows.length === 0
            ? q
              ? 'No one matches that search.'
              : 'No one registered yet.'
            : null
        }
      >
        {rows.map((student) => (
          <tr key={student.id}>
            <td className="px-4 py-3">
              <Link href={`/students/${student.id}`} className="font-medium hover:underline">
                {student.givenName} {student.fatherName} {student.grandfatherName ?? ''}
              </Link>
            </td>
            <td className="px-4 py-3 font-mono text-xs">{student.studentNumber}</td>
            <td className="px-4 py-3">{student.phone}</td>
            <td className="px-4 py-3">{branchName(student.branchId)}</td>
            <td className="px-4 py-3">
              <StudentStatusBadge status={student.status} />
            </td>
          </tr>
        ))}
      </SimpleTable>
      {students.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={students.isFetchingNextPage}
          onClick={() => void students.fetchNextPage()}
        >
          {students.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
