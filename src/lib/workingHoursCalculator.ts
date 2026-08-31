export interface AttendanceDayRecord {
  workDate: string; // YYYY-MM-DD
  checkInAt?: string | Date | null;
  checkOutAt?: string | Date | null;
}

export interface WorkingHoursCalcOptions {
  startTime?: string | null; // e.g. "11:37 AM" or "11:37"
  endTime?: string | null;   // e.g. "12:04 PM" or "12:04" or "" (in progress)
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null;   // YYYY-MM-DD
  startTimestamp?: number | null;
  endTimestamp?: number | null;
  attendanceRecords?: AttendanceDayRecord[] | Record<string, AttendanceDayRecord>;
  approvedLeaveDates?: (string | Date)[] | Set<string>;
  approvedWfhDates?: (string | Date)[] | Set<string>;
  workingDays?: string[]; // e.g. ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  standardStartMinutes?: number; // default 540 (09:00 AM)
  standardEndMinutes?: number;   // default 1080 (06:00 PM)
  isInProgress?: boolean;
}

export interface WorkingHoursCalcResult {
  totalMinutes: number;
  formattedDuration: string;
  daysBreakdown: Array<{
    date: string;
    dayName: string;
    isOffDay: boolean;
    isLeave: boolean;
    isWfh: boolean;
    effectiveStartMinutes: number;
    effectiveEndMinutes: number;
    minutesWorked: number;
    note?: string;
  }>;
}

const DEFAULT_WORKING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYMD(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Parses time string like "11:37 AM", "12:04 PM", or "09:30" or "09:30:00" into minutes from midnight (0 - 1439).
 */
export function parseTimeToMinutes(t?: string | null): number | null {
  if (!t || t === "-" || t.toLowerCase().includes("progress")) return null;
  const trimmed = t.trim();
  const parts = trimmed.split(" ");
  if (parts.length === 2) {
    const [time, modifier] = parts;
    const [hStr, mStr] = time.split(":");
    let hours = parseInt(hStr, 10);
    const minutes = parseInt(mStr, 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    const mod = modifier.toUpperCase();
    if (mod === "PM" && hours < 12) hours += 12;
    if (mod === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  if (trimmed.includes(":")) {
    const [hStr, mStr] = trimmed.split(":");
    const hours = parseInt(hStr, 10);
    const minutes = parseInt(mStr, 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
  }
  return null;
}

/**
 * Extracts minutes from midnight (Asia/Kolkata timezone) from a Date, ISO string, or time string.
 */
export function extractKolkataMinutes(val?: string | Date | null): number | null {
  if (!val) return null;
  if (typeof val === "string" && !val.includes("T") && !val.includes("Z") && val.includes(":")) {
    return parseTimeToMinutes(val);
  }
  const d = typeof val === "string" ? new Date(val) : val;
  if (isNaN(d.getTime())) return null;

  try {
    const timeStr = d.toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const [h, m] = timeStr.split(":").map(Number);
    if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
  return null;
}

/**
 * Formats total minutes into human readable string:
 * e.g. "9h 27m", "27m", or "< 1m"
 */
export function formatWorkingDuration(totalMinutes: number, inProgress = false): string {
  if (totalMinutes <= 0) {
    return inProgress ? "In Progress" : "< 1m";
  }
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  const parts = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(" ") || "< 1m";
}

/**
 * Core EMS Working Hours Calculation:
 * Implements:
 * 1. Working hours 9:00 AM (540m) to 6:00 PM (1080m)
 * 2. Punch-out < 6:00 PM -> pause time considered 6:00 PM
 * 3. Punch-out > 6:00 PM -> pause time considered actual punch-out
 * 4. Punch-in < 9:00 AM -> resume time considered 9:00 AM
 * 5. Punch-in > 9:00 AM -> resume time considered actual punch-in
 * 6. Off days and approved leaves excluded (0 minutes)
 * 7. WFH treated as normal working day (9:00 AM to 6:00 PM)
 */
export function calculateWorkingHoursDuration(options: WorkingHoursCalcOptions): WorkingHoursCalcResult {
  const standardStart = options.standardStartMinutes ?? 540; // 9:00 AM
  const standardEnd = options.standardEndMinutes ?? 1080;    // 6:00 PM

  // Normalize startDate and endDate
  let startDateStr = options.startDate ? options.startDate.slice(0, 10) : "";
  let endDateStr = options.endDate ? options.endDate.slice(0, 10) : "";

  if (options.startTimestamp && !startDateStr) {
    startDateStr = formatYMD(new Date(options.startTimestamp));
  }
  if (options.endTimestamp && !endDateStr) {
    endDateStr = formatYMD(new Date(options.endTimestamp));
  }

  const todayStr = formatYMD(new Date());
  if (!startDateStr) startDateStr = todayStr;
  if (!endDateStr) endDateStr = options.isInProgress ? todayStr : startDateStr;

  // Ensure chronological order
  if (endDateStr < startDateStr) {
    endDateStr = startDateStr;
  }

  // Parse task start & end minutes
  let taskStartMinutes = parseTimeToMinutes(options.startTime);
  if (taskStartMinutes === null && options.startTimestamp) {
    taskStartMinutes = extractKolkataMinutes(new Date(options.startTimestamp));
  }
  if (taskStartMinutes === null) taskStartMinutes = standardStart;

  let taskEndMinutes = parseTimeToMinutes(options.endTime);
  if (taskEndMinutes === null && options.endTimestamp) {
    taskEndMinutes = extractKolkataMinutes(new Date(options.endTimestamp));
  }

  const isStillInProgress = options.isInProgress || !options.endTime || options.endTime === "-" || options.endTime.toLowerCase().includes("progress");

  // Normalize Attendance records lookup
  const attendanceMap: Record<string, AttendanceDayRecord> = {};
  if (Array.isArray(options.attendanceRecords)) {
    options.attendanceRecords.forEach((att) => {
      const key = String(att.workDate).slice(0, 10);
      attendanceMap[key] = att;
    });
  } else if (options.attendanceRecords) {
    Object.entries(options.attendanceRecords).forEach(([key, val]) => {
      attendanceMap[key.slice(0, 10)] = val;
    });
  }

  // Normalize Leave set
  const leavesSet = new Set<string>();
  if (options.approvedLeaveDates) {
    if (options.approvedLeaveDates instanceof Set) {
      options.approvedLeaveDates.forEach((d) => leavesSet.add(String(d).slice(0, 10)));
    } else if (Array.isArray(options.approvedLeaveDates)) {
      options.approvedLeaveDates.forEach((d) => leavesSet.add(typeof d === "string" ? d.slice(0, 10) : formatYMD(d)));
    }
  }

  // Normalize WFH set
  const wfhSet = new Set<string>();
  if (options.approvedWfhDates) {
    if (options.approvedWfhDates instanceof Set) {
      options.approvedWfhDates.forEach((d) => wfhSet.add(String(d).slice(0, 10)));
    } else if (Array.isArray(options.approvedWfhDates)) {
      options.approvedWfhDates.forEach((d) => wfhSet.add(typeof d === "string" ? d.slice(0, 10) : formatYMD(d)));
    }
  }

  const allowedWorkingDays = options.workingDays || DEFAULT_WORKING_DAYS;

  let totalMinutes = 0;
  const daysBreakdown: WorkingHoursCalcResult["daysBreakdown"] = [];

  // Iterate day by day from startDate to endDate
  const curDate = parseYMD(startDateStr);
  const finalDate = parseYMD(endDateStr);

  while (curDate <= finalDate) {
    const curDateStr = formatYMD(curDate);
    const dayOfWeek = WEEKDAY_NAMES[curDate.getDay()];
    const isFirstDay = curDateStr === startDateStr;
    const isLastDay = curDateStr === endDateStr;

    const isWfh = wfhSet.has(curDateStr);
    const isLeave = leavesSet.has(curDateStr) && !isWfh;
    const isStandardOffDay = !allowedWorkingDays.includes(dayOfWeek);
    const isOffDay = isStandardOffDay && !isWfh;

    const attRecord = attendanceMap[curDateStr];
    const punchInMins = attRecord?.checkInAt ? extractKolkataMinutes(attRecord.checkInAt) : null;
    const punchOutMins = attRecord?.checkOutAt ? extractKolkataMinutes(attRecord.checkOutAt) : null;

    if (isLeave) {
      daysBreakdown.push({
        date: curDateStr,
        dayName: dayOfWeek,
        isOffDay: false,
        isLeave: true,
        isWfh: false,
        effectiveStartMinutes: 0,
        effectiveEndMinutes: 0,
        minutesWorked: 0,
        note: "Approved Leave"
      });
      curDate.setDate(curDate.getDate() + 1);
      continue;
    }

    if (isOffDay && !punchInMins) {
      daysBreakdown.push({
        date: curDateStr,
        dayName: dayOfWeek,
        isOffDay: true,
        isLeave: false,
        isWfh: false,
        effectiveStartMinutes: 0,
        effectiveEndMinutes: 0,
        minutesWorked: 0,
        note: "Weekly Off"
      });
      curDate.setDate(curDate.getDate() + 1);
      continue;
    }

    // Determine Day Effective Start:
    // Rule: "If employee punches in before 9:00 AM, consider 9:00 AM as resume time. If after 9:00 AM, consider actual punch-in time."
    let effectiveDayStart = standardStart;
    if (punchInMins !== null) {
      if (punchInMins <= standardStart) {
        effectiveDayStart = standardStart; // 9:00 AM
      } else {
        effectiveDayStart = punchInMins;   // Actual punch-in
      }
    }

    // Determine Day Effective End / Pause:
    // Rule: "If employee punches out before 6:00 PM, consider 6:00 PM as pause time. If after 6:00 PM, consider actual punch-out time."
    let effectiveDayEnd = standardEnd;
    if (punchOutMins !== null) {
      if (punchOutMins <= standardEnd) {
        effectiveDayEnd = standardEnd;   // 6:00 PM
      } else {
        effectiveDayEnd = punchOutMins;  // Overtime punch-out
      }
    }

    // First day vs Intermediate day vs Final day work windows
    let dayWorkStart = effectiveDayStart;
    if (isFirstDay) {
      dayWorkStart = Math.max(taskStartMinutes, effectiveDayStart);
    }

    let dayWorkEnd = effectiveDayEnd;
    if (isLastDay) {
      if (isStillInProgress) {
        // If still in progress today, take current time or effectiveDayEnd
        const nowMins = extractKolkataMinutes(new Date()) ?? standardEnd;
        dayWorkEnd = Math.min(nowMins, effectiveDayEnd);
      } else if (taskEndMinutes !== null) {
        dayWorkEnd = Math.min(taskEndMinutes, effectiveDayEnd);
      }
    }

    let minutesWorked = 0;
    if (dayWorkEnd > dayWorkStart) {
      minutesWorked = dayWorkEnd - dayWorkStart;
      totalMinutes += minutesWorked;
    }

    daysBreakdown.push({
      date: curDateStr,
      dayName: dayOfWeek,
      isOffDay: false,
      isLeave: false,
      isWfh,
      effectiveStartMinutes: dayWorkStart,
      effectiveEndMinutes: dayWorkEnd,
      minutesWorked,
      note: isWfh ? "Work From Home" : (punchOutMins && punchOutMins > standardEnd ? "Includes Overtime" : undefined)
    });

    curDate.setDate(curDate.getDate() + 1);
  }

  return {
    totalMinutes,
    formattedDuration: formatWorkingDuration(totalMinutes, isStillInProgress),
    daysBreakdown
  };
}
