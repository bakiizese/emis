import { z } from 'zod';

const count = z.number().int().min(0);

/**
 * The portal home. Each block is present only when the caller holds the permission behind it (and
 * covers only the branches their grant reaches), so the same endpoint serves an Admin, a
 * Coordinator and the front desk without any of them seeing what they shouldn't.
 */
export const dashboardSchema = z.object({
  /** The institution's calendar date the figures are for. */
  today: z.iso.date(),
  currency: z.string(),
  admissions: z
    .object({
      /** Applications nobody has picked up yet. */
      newCount: count,
      /** Everything still in the pipeline. */
      openCount: count,
      last7Days: count,
    })
    .optional(),
  students: z.object({ active: count }).optional(),
  classes: z
    .object({
      open: count,
      running: count,
      waitlisted: count,
      /** Seats filled against seats available, per shift, over classes taking or holding students. */
      occupancy: z.array(
        z.object({
          shiftId: z.uuid(),
          shiftName: z.string(),
          capacity: count,
          enrolled: count,
        }),
      ),
      /** Classes that start within two weeks, soonest first. */
      startingSoon: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          startDate: z.iso.date(),
          capacity: count,
          enrolled: count,
          seatsLeft: count,
        }),
      ),
    })
    .optional(),
  enrollmentsByDepartment: z
    .array(z.object({ departmentId: z.uuid().nullable(), name: z.string(), active: count }))
    .optional(),
  /** Money figures for people who can see finance reports. Whole santim. */
  finance: z
    .object({
      collectedThisMonth: count,
      collectedLastMonth: count,
      outstanding: count,
      overdue: count,
      overdueCount: count,
    })
    .optional(),
  /** What the front desk needs today. */
  desk: z
    .object({
      collectedToday: count,
      paymentsToday: count,
      dueToday: count,
      overdueCount: count,
    })
    .optional(),
  approvals: z.object({ pending: count }).optional(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
