import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { employeeRouter } from "../modules/employees/employee.routes.js";
import { payrollRouter } from "../modules/payroll/payroll.routes.js";
import { attendanceRouter } from "../modules/attendance/attendance.routes.js";
import { wfhRouter } from "../modules/wfh/wfh.routes.js";
import { expenseRouter } from "../modules/expenses/expense.routes.js";
import { notificationRouter } from "../modules/notifications/notification.routes.js";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes.js";
import { orgRouter } from "../modules/org/org.routes.js";
import { workTrackRouter } from "../modules/work-track/work-track.routes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/employees", employeeRouter);
apiRouter.use("/payroll", payrollRouter);
apiRouter.use("/attendance", attendanceRouter);
apiRouter.use("/wfh", wfhRouter);
apiRouter.use("/expenses", expenseRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/work-track", workTrackRouter);
apiRouter.use("/", orgRouter);
