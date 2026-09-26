import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClassList } from '../../../components/class-list';
import { JsonLd } from '../../../components/json-ld';
import { LinkButton } from '../../../components/link-button';
import { getCourse, getProfile, NotFoundError, term } from '../../../lib/api';
import { durationLabel, programTypeLabel } from '../../../lib/format';
import { siteUrl } from '../../../lib/site';

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  try {
    return await getCourse(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await load(id);
  return {
    title: detail.course.name,
    description:
      detail.program.description || `${detail.course.name}, part of ${detail.program.name}.`,
    alternates: { canonical: `/courses/${id}` },
  };
}

export default async function CoursePage({ params }: Props) {
  const { id } = await params;
  const [detail, profile] = await Promise.all([load(id), getProfile()]);
  const { course, program, department, classes } = detail;
  const canRegister = profile.modules.pre_registration;
  const duration = durationLabel(course.durationWeeks, course.totalHours);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Course',
          name: course.name,
          description: program.description || `${course.name}, part of ${program.name}.`,
          url: `${siteUrl()}/courses/${course.id}`,
          provider: { '@type': 'EducationalOrganization', name: profile.name, url: siteUrl() },
        }}
      />

      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link href="/courses" className="hover:underline">
          {term(profile, 'course', true)}
        </Link>
        {' / '}
        <Link href={`/courses#${department.code.toLowerCase()}`} className="hover:underline">
          {department.name}
        </Link>
      </nav>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{course.name}</h1>
      <p className="text-muted-foreground mt-1">
        {program.name} · {programTypeLabel(program.type)}
      </p>
      {program.description ? <p className="mt-4 max-w-3xl">{program.description}</p> : null}

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {duration ? (
          <div>
            <dt className="text-muted-foreground">Length</dt>
            <dd className="font-medium">{duration}</dd>
          </div>
        ) : null}
        {course.certificateEligible ? (
          <div>
            <dt className="text-muted-foreground">On completion</dt>
            <dd className="font-medium">Certificate you can verify online</dd>
          </div>
        ) : null}
      </dl>

      <h2 className="mt-12 text-2xl font-semibold tracking-tight">Upcoming classes</h2>
      {classes.length > 0 ? (
        <div className="mt-6">
          <ClassList classes={classes} canRegister={canRegister} />
        </div>
      ) : (
        <div className="bg-muted mt-6 rounded-xl p-6">
          <p>No classes are scheduled yet.</p>
          {canRegister ? (
            <>
              <p className="text-muted-foreground mt-1 text-sm">
                Pre-register and we&apos;ll tell you when the next one opens.
              </p>
              <LinkButton href={`/pre-register?course=${course.id}`} className="mt-4">
                Pre-register
              </LinkButton>
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}
