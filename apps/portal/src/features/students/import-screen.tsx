'use client';

import {
  STUDENT_IMPORT_COLUMNS,
  STUDENT_IMPORT_MAX_BYTES,
  STUDENT_IMPORT_MAX_ROWS,
  type StudentImportResult,
  studentImportResultSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { SelectField } from '@emis/ui/components/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { studentImportTemplate } from './import-template';

function downloadTemplate() {
  const blob = new Blob([studentImportTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'students-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function Summary({ result }: { result: StudentImportResult }) {
  const tiles: [string, number, 'success' | 'warning' | 'danger'][] = [
    [result.dryRun ? 'Ready to import' : 'Imported', result.imported, 'success'],
    ['Likely duplicates, left out', result.skippedDuplicates, 'warning'],
    ['Rows with problems, left out', result.skippedErrors, 'danger'],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map(([label, count, tone]) => (
          <div key={label} className="border-border rounded-xl border p-4">
            <Badge tone={tone}>{label}</Badge>
            <p className="mt-2 text-2xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        {result.totalRows} row{result.totalRows === 1 ? '' : 's'} read.
        {result.ignoredColumns.length > 0
          ? ` Columns not used: ${result.ignoredColumns.join(', ')}.`
          : ''}
      </p>
      {result.issues.length > 0 ? (
        <>
          <SimpleTable head={['Line', 'Column', 'What to fix']}>
            {result.issues.map((issue, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-mono">{issue.row}</td>
                <td className="px-4 py-2">
                  {issue.kind === 'duplicate' ? (
                    <Badge tone="warning">duplicate</Badge>
                  ) : (
                    (issue.field ?? '—')
                  )}
                </td>
                <td className="px-4 py-2">{issue.message}</td>
              </tr>
            ))}
          </SimpleTable>
          {result.issuesTruncated ? (
            <p className="text-muted-foreground text-sm">
              Only the first {result.issues.length} problems are listed. Fix these and check again
              to see the rest.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function StudentImportScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const idempotency = useIdempotencyKey();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'import'>('skip');
  const [result, setResult] = useState<StudentImportResult | null>(null);
  const students = term('student', true).toLowerCase();

  const body = { csv, onDuplicate };
  const check = useMutation({
    mutationFn: () =>
      apiRequest('/imports/students/preview', {
        method: 'POST',
        body,
        schema: studentImportResultSchema,
      }),
    onSuccess: setResult,
  });
  const run = useMutation({
    mutationFn: () =>
      apiRequest('/imports/students', {
        method: 'POST',
        body,
        schema: studentImportResultSchema,
        idempotencyKey: idempotency.keyFor(body),
      }),
    onSuccess: async (done) => {
      setResult(done);
      await queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });

  async function choose(file: File | undefined) {
    setResult(null);
    check.reset();
    run.reset();
    setFileError(null);
    setCsv(null);
    setFileName('');
    if (!file) return;
    if (file.size > STUDENT_IMPORT_MAX_BYTES) {
      setFileError(
        `That file is too big. Split it into files of up to ${STUDENT_IMPORT_MAX_ROWS.toLocaleString()} ${students} each.`,
      );
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  const busy = check.isPending || run.isPending;
  const error = check.error ?? run.error;
  const ready = result?.dryRun === true && result.imported > 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={`Import ${students}`}
        description="Add many at once from a spreadsheet saved as CSV. Nothing is saved until you check the file and confirm."
        action={
          <Link href="/students" className="text-primary text-sm hover:underline">
            Back to {students}
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Get the template</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          <p className="text-sm">
            Fill in one row per person. The first line must be the column names. Save as{' '}
            <strong>CSV UTF-8</strong>, so Amharic names come through.
          </p>
          <Button variant="secondary" onClick={downloadTemplate}>
            Download template
          </Button>
          <ul className="text-muted-foreground grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {STUDENT_IMPORT_COLUMNS.map((c) => (
              <li key={c.key}>
                <code className="text-foreground">{c.key}</code>
                {c.required ? ' (required)' : ''}
                {c.note ? `: ${c.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Choose your file and check it</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="import-file" className="text-sm font-medium">
              CSV file (up to {STUDENT_IMPORT_MAX_ROWS.toLocaleString()} rows)
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void choose(e.target.files?.[0])}
              className="block text-sm"
            />
            {fileName ? <p className="text-muted-foreground text-sm">{fileName}</p> : null}
          </div>
          {fileError ? <Alert tone="error">{fileError}</Alert> : null}
          <div className="max-w-sm">
            <SelectField
              label="If someone looks like a student we already have"
              value={onDuplicate}
              onChange={(e) => {
                setOnDuplicate(e.target.value as 'skip' | 'import');
                setResult(null);
              }}
            >
              <option value="skip">Leave them out (recommended)</option>
              <option value="import">Add them anyway</option>
            </SelectField>
          </div>
          {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
          <Button disabled={csv === null || busy} onClick={() => check.mutate()}>
            {check.isPending ? 'Checking…' : 'Check the file'}
          </Button>
        </div>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {result.dryRun ? '3. What would happen' : 'Done'}
            </CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <Summary result={result} />
            {ready ? (
              <div className="flex items-center gap-3">
                <Button disabled={busy} onClick={() => run.mutate()}>
                  {run.isPending ? 'Importing…' : `Import ${result.imported} ${students}`}
                </Button>
                <span className="text-muted-foreground text-sm">
                  Rows with problems are skipped.
                </span>
              </div>
            ) : null}
            {!result.dryRun ? (
              <Link href="/students" className="text-primary text-sm hover:underline">
                See the {students}
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
