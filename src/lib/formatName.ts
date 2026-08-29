export function formatFullName(
  emp?: {
    firstName?: string | null;
    middleName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    name?: string | null;
    fullName?: string | null;
    employee?: any;
    user?: any;
    id?: string | null;
    userId?: string | null;
  } | null | any
): string {
  if (!emp) return "";
  if (typeof emp === "string") return emp.trim();

  // Check displayName on any level
  const displayName = emp.displayName || emp.employee?.displayName || emp.user?.employee?.displayName || emp.user?.displayName;
  if (displayName && String(displayName).trim()) {
    return String(displayName).trim();
  }

  // Extract names from emp, or emp.employee, or emp.user.employee, or emp.user
  const target = (emp.firstName || emp.middleName || emp.lastName || emp.name || emp.fullName)
    ? emp
    : (emp.employee?.firstName || emp.employee?.middleName || emp.employee?.lastName || emp.employee?.name || emp.employee?.fullName)
      ? emp.employee
      : (emp.user?.employee?.firstName || emp.user?.employee?.middleName || emp.user?.employee?.lastName)
        ? emp.user.employee
        : (emp.user || emp);

  const first = target.firstName ? String(target.firstName).trim() : "";
  const middle = target.middleName ? String(target.middleName).trim() : "";
  const last = target.lastName && String(target.lastName).trim() !== "-" ? String(target.lastName).trim() : "";
  const combined = [first, middle, last].filter(Boolean).join(" ");
  if (combined) return combined;

  const fallbackName = target.fullName || target.name || emp.fullName || emp.name || target.user?.email || emp.email;
  if (fallbackName && String(fallbackName).trim()) {
    return String(fallbackName).trim();
  }

  return "";
}
