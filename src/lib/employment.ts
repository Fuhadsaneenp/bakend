/** Employment dates are calendar dates; the last working day is inclusive (Asia/Kolkata). */
export type EmploymentRecord = {
  status?: string | null;
  dateOfJoining?: Date | string | null;
  dateOfExit?: Date | string | null;
  user?: { isActive?: boolean } | null;
};
export const EXIT_REASONS = ["Resigned", "Terminated", "Retired", "Contract Completed", "End of Internship", "Others"] as const;
export function calendarDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(value);
}
export function hasExited(employee: EmploymentRecord, at: Date | string = new Date()): boolean {
  if (employee.dateOfExit) return calendarDate(employee.dateOfExit) < calendarDate(at);
  return employee.status === "TERMINATED";
}
export function isActiveEmployee(employee: EmploymentRecord, at: Date | string = new Date()): boolean {
  return !hasExited(employee, at) && (!employee.status || employee.status === "ACTIVE") &&
    employee.user?.isActive !== false &&
    (!employee.dateOfJoining || calendarDate(employee.dateOfJoining) <= calendarDate(at));
}
/** Historical rosters ignore today's account/status flags when employment dates are available. */
export function employedDuring(employee: EmploymentRecord, start: Date | string, end: Date | string): boolean {
  return (!employee.dateOfJoining || calendarDate(employee.dateOfJoining) <= calendarDate(end)) &&
    (employee.dateOfExit ? calendarDate(employee.dateOfExit) >= calendarDate(start) : employee.status !== "TERMINATED");
}
