import { calculateWorkingHoursDuration } from "./workingHoursCalculator.js";

function runTests() {
  console.log("=== Testing EMS-Integrated Working Hours Calculator ===");

  // Test 1: Aug 29 (11:37 AM) to Aug 31 (12:04 PM) with Sunday off
  // Aug 29 (Sat): 11:37 AM (697) to 6:00 PM (1080) -> 383 mins (6h 23m)
  // Aug 30 (Sun): Off-day -> 0 mins
  // Aug 31 (Mon): 9:00 AM (540) to 12:04 PM (724) -> 184 mins (3h 4m)
  // Total = 383 + 184 = 567 mins (9h 27m)
  const res1 = calculateWorkingHoursDuration({
    startTime: "11:37 AM",
    endTime: "12:04 PM",
    startDate: "2026-08-29",
    endDate: "2026-08-31",
    attendanceRecords: [
      { workDate: "2026-08-29", checkInAt: "09:00", checkOutAt: "17:30" }, // Punched out early (5:30 PM), counted till 6:00 PM
      { workDate: "2026-08-31", checkInAt: "08:45", checkOutAt: "18:00" }  // Punched in early (8:45 AM), counted from 9:00 AM
    ],
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  });

  console.log("Test 1 (Aug 29 to Aug 31):", res1.formattedDuration, "Total Mins:", res1.totalMinutes);
  if (res1.totalMinutes === 567 && res1.formattedDuration === "9h 27m") {
    console.log("✓ Test 1 PASSED");
  } else {
    console.error("✗ Test 1 FAILED, expected 9h 27m, got", res1.formattedDuration);
  }

  // Test 2: Overtime punch-out (punched out at 7:30 PM)
  // Started at 2:00 PM (840) to 7:30 PM (1170) -> 330 mins (5h 30m)
  const res2 = calculateWorkingHoursDuration({
    startTime: "02:00 PM",
    endTime: "07:30 PM",
    startDate: "2026-08-31",
    endDate: "2026-08-31",
    attendanceRecords: [
      { workDate: "2026-08-31", checkInAt: "09:00", checkOutAt: "19:30" } // Overtime punch-out at 19:30
    ]
  });

  console.log("Test 2 (Overtime):", res2.formattedDuration, "Total Mins:", res2.totalMinutes);
  if (res2.totalMinutes === 330 && res2.formattedDuration === "5h 30m") {
    console.log("✓ Test 2 PASSED");
  } else {
    console.error("✗ Test 2 FAILED, expected 5h 30m, got", res2.formattedDuration);
  }

  // Test 3: Late punch-in (punched in at 10:15 AM)
  // Started task at 9:00 AM, but employee punched in at 10:15 AM (615) to 1:15 PM (795) -> 180 mins (3h)
  const res3 = calculateWorkingHoursDuration({
    startTime: "09:00 AM",
    endTime: "01:15 PM",
    startDate: "2026-08-31",
    endDate: "2026-08-31",
    attendanceRecords: [
      { workDate: "2026-08-31", checkInAt: "10:15", checkOutAt: "18:00" }
    ]
  });

  console.log("Test 3 (Late punch-in):", res3.formattedDuration, "Total Mins:", res3.totalMinutes);
  if (res3.totalMinutes === 180 && res3.formattedDuration === "3h") {
    console.log("✓ Test 3 PASSED");
  } else {
    console.error("✗ Test 3 FAILED, expected 3h, got", res3.formattedDuration);
  }

  // Test 4: WFH day (Work From Home) on Sunday
  // Aug 30 (Sun) is normally off, but employee had approved WFH!
  // Work from 9:00 AM to 6:00 PM = 540 mins (9h)
  const res4 = calculateWorkingHoursDuration({
    startTime: "09:00 AM",
    endTime: "06:00 PM",
    startDate: "2026-08-30",
    endDate: "2026-08-30",
    approvedWfhDates: ["2026-08-30"],
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  });

  console.log("Test 4 (WFH on Sunday):", res4.formattedDuration, "Total Mins:", res4.totalMinutes);
  if (res4.totalMinutes === 540 && res4.formattedDuration === "9h") {
    console.log("✓ Test 4 PASSED");
  } else {
    console.error("✗ Test 4 FAILED, expected 9h, got", res4.formattedDuration);
  }

  // Test 5: Approved Leave
  // Aug 31 is approved sick leave -> 0 mins
  const res5 = calculateWorkingHoursDuration({
    startTime: "09:00 AM",
    endTime: "06:00 PM",
    startDate: "2026-08-31",
    endDate: "2026-08-31",
    approvedLeaveDates: ["2026-08-31"]
  });

  console.log("Test 5 (Approved Leave):", res5.formattedDuration, "Total Mins:", res5.totalMinutes);
  if (res5.totalMinutes === 0 && res5.formattedDuration === "< 1m") {
    console.log("✓ Test 5 PASSED");
  } else {
    console.error("✗ Test 5 FAILED, expected < 1m, got", res5.formattedDuration);
  }

  console.log("=== All Tests Complete ===");
}

runTests();
