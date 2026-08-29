export function formatFullName(emp?: { firstName?: string | null; middleName?: string | null; lastName?: string | null; displayName?: string | null; name?: string | null; fullName?: string | null; employee?: any; user?: any } | null | any): string {
  if (!emp) return "";
  if (typeof emp === "string") return emp.trim();
  const target = emp.employee || emp.user || emp;
  const first = target.firstName ? String(target.firstName).trim() : "";
  const middle = target.middleName ? String(target.middleName).trim() : "";
  const last = target.lastName && String(target.lastName).trim() !== "-" ? String(target.lastName).trim() : "";
  const combined = [first, middle, last].filter(Boolean).join(" ");
  if (combined) return combined;
  if (target.fullName) return String(target.fullName).trim();
  if (target.name) return String(target.name).trim();
  if (emp.fullName) return String(emp.fullName).trim();
  if (emp.name) return String(emp.name).trim();
  return "";
}
