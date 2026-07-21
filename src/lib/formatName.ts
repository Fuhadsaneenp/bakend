export function formatFullName(emp?: { firstName?: string | null; middleName?: string | null; lastName?: string | null } | null): string {
  if (!emp) return "";
  const first = emp.firstName ? emp.firstName.trim() : "";
  const middle = emp.middleName ? emp.middleName.trim() : "";
  const last = emp.lastName && emp.lastName.trim() !== "-" ? emp.lastName.trim() : "";
  return [first, middle, last].filter(Boolean).join(" ");
}
