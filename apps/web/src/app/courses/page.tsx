import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@emis/ui/components/badge';

import { getCatalog, getProfile, term } from '../../lib/api';
import { durationLabel, programTypeLabel } from '../../lib/format';

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getProfile();
  return {
    title: term(profile, 'course', true),
    description: 'Every program and level we teach.',
    alternates: { canonical: '/courses' },
  };
}

export default async function CoursesPage() {
  const profile = await getProfile();
  const { departments } = await getCatalog();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{term(profile, 'course', true)}</h1>

      {departments.length === 0 ? (
        <p className="text-muted-foreground mt-6">
          Our catalog is being updated. Please check back soon.
        </p>
      ) : null}

      {departments.map((department) => (
        <section
          key={department.id}
          id={department.code.toLowerCase()}
          className="mt-12 scroll-mt-20"
        >
          <h2 className="text-2xl font-semibold tracking-tight">{department.name}</h2>
          {department.description ? (
            <p className="text-muted-foreground mt-1 max-w-3xl">{department.description}</p>
          ) : null}

          {department.programs.map((program) => (
            <div key={program.id} className="mt-8">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{program.name}</h3>
                <Badge tone="info">{programTypeLabel(program.type)}</Badge>
              </div>
              {program.description ? (
                <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
                  {program.description}
                </p>
              ) : null}
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {program.courses.map((course) => {
                  const duration = durationLabel(course.durationWeeks, course.totalHours);
                  return (
                    <li key={course.id}>
                      <Link
                        href={`/courses/${course.id}`}
                        className="border-border bg-background hover:border-primary block rounded-xl border p-4 transition-colors"
                      >
                        <span className="font-medium">{course.name}</span>
                        {duration ? (
                          <span className="text-muted-foreground mt-1 block text-sm">
                            {duration}
                          </span>
                        ) : null}
                        {course.certificateEligible ? (
                          <span className="text-muted-foreground mt-1 block text-sm">
                            Certificate on completion
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
