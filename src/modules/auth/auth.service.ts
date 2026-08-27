import bcrypt from "bcryptjs";
import { createHash, randomInt } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { emailService } from "../../integrations/email/email.service.js";
import { notificationService } from "../notifications/notification.service.js";

const signAccessToken = (payload: AuthUser) => jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as any });
const signRefreshToken = (payload: AuthUser) => jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_TTL as any });

const resetCodes = new Map<string, { codeHash: string; expires: number; attempts: number }>();
const hashResetCode = (email: string, code: string) => createHash("sha256")
  .update(`${email}:${code}:${env.JWT_REFRESH_SECRET}`)
  .digest("hex");
const createResetCode = () => randomInt(100000, 1_000_000).toString();
const resetRequestMessage = "If an account exists for this email, a password reset code has been sent.";

export const authService = {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } }
    });
    if (!user || !user.isActive) throw new ApiError(401, "Invalid credentials");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError(401, "Invalid credentials");

    const payload = { id: user.id, companyId: user.companyId, role: user.role, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    await prisma.user.update({ where: { id: user.id }, data: { refreshHash: await bcrypt.hash(refreshToken, 10) } });

    // Notify Super Admin and HR Admin of login in background
    if (user.role !== "SUPER_ADMIN") {
      setImmediate(async () => {
        try {
          const empName = user.employee
            ? `${user.employee.firstName} ${user.employee.lastName || ""}`.trim()
            : user.email.split("@")[0];
          const nowStr = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });

          await notificationService.notifyAttendance({
            companyId: user.companyId,
            employeeName: empName,
            employeeUserId: user.id,
            type: "LOGIN",
            timeStr: nowStr
          });
          console.log(`[Auth] Dispatched login notification for ${empName} (${user.email})`);
        } catch (notifErr) {
          console.error("[Auth] notifyAttendance failed:", notifErr);
        }
      });
    }

    return { accessToken, refreshToken, user: payload };
  },

  async logout(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { employee: { select: { firstName: true, lastName: true } } }
      });
      if (user && user.role !== "SUPER_ADMIN") {
        const empName = user.employee
          ? `${user.employee.firstName} ${user.employee.lastName || ""}`.trim()
          : user.email.split("@")[0];
        const nowStr = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });

        setImmediate(async () => {
          try {
            await notificationService.notifyAttendance({
              companyId: user.companyId,
              employeeName: empName,
              employeeUserId: user.id,
              type: "LOGOUT",
              timeStr: nowStr
            });
            console.log(`[Auth] Dispatched logout notification for ${empName} (${user.email})`);
          } catch (e) {
            console.error("[Auth] Logout notification error:", e);
          }
        });
      }

      await prisma.user.update({ where: { id: userId }, data: { refreshHash: null } });
    } catch {}
    return { ok: true };
  },

  async refresh(refreshToken: string) {
    let payload: AuthUser;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as AuthUser;
    } catch {
      throw new ApiError(401, "Invalid refresh token");
    }
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user?.isActive || !user.refreshHash || !(await bcrypt.compare(refreshToken, user.refreshHash))) {
      throw new ApiError(401, "Invalid refresh token");
    }
    const freshPayload = { id: user.id, companyId: user.companyId, role: user.role, email: user.email };
    return { accessToken: signAccessToken(freshPayload) };
  },

  async updatePasswordDirect(userId: string, newPass: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, "User not found");

    const newHash = await bcrypt.hash(newPass, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, refreshHash: null }
    });
    return { ok: true };
  },

  async changePassword(userId: string, currentPass: string, newPass: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, "User not found");

    const valid = await bcrypt.compare(currentPass, user.passwordHash);
    if (!valid) throw new ApiError(400, "Current password is incorrect");

    const newHash = await bcrypt.hash(newPass, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, refreshHash: null }
    });
    return { ok: true };
  },

  async requestResetPassword(email: string) {
    const normalizedEmail = email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user?.isActive) return { ok: true, message: resetRequestMessage };

    const code = createResetCode();
    resetCodes.set(normalizedEmail, {
      codeHash: hashResetCode(normalizedEmail, code),
      expires: Date.now() + 15 * 60 * 1000,
      attempts: 0
    });

    let emailResult: Awaited<ReturnType<typeof emailService.send>>;
    try {
      emailResult = await emailService.send({
        to: user.email,
        subject: "Your Second Tales EMS password reset code",
        html: `
          <div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.5;">
            <h2 style="margin: 0 0 12px;">Password reset code</h2>
            <p>Use this 6-digit code to reset your Second Tales EMS password.</p>
            <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #047857; margin: 20px 0;">${code}</p>
            <p>This code expires in 15 minutes. If you did not request this, you can ignore this email.</p>
          </div>
        `
      });
    } catch (error) {
      const deliveryError = error instanceof Error ? error.message : "Unknown email provider error";
      console.error("[PASSWORD RESET EMAIL FAILED]", deliveryError);
      if (env.NODE_ENV !== "production") {
        throw new ApiError(502, "Password reset email could not be sent", { reason: deliveryError });
      }
      throw new ApiError(502, "Password reset email could not be sent");
    }

    if (!emailResult.delivered && env.NODE_ENV !== "production") {
      console.log("\n=========================================");
      console.log(`[PASSWORD RESET CODE] Reset PIN for ${user.email} is: ${code}`);
      console.log("SMTP is not configured, so the reset PIN was not emailed.");
      console.log("=========================================\n");
    }

    return {
      ok: true,
      message: resetRequestMessage
    };
  },

  async resetPassword(email: string, code: string, newPass: string) {
    const normalizedEmail = email.toLowerCase();
    const record = resetCodes.get(normalizedEmail);
    if (!record) throw new ApiError(400, "No password reset requested for this email");

    if (Date.now() > record.expires) {
      resetCodes.delete(normalizedEmail);
      throw new ApiError(400, "Reset code has expired");
    }
    if (record.attempts >= 5) {
      resetCodes.delete(normalizedEmail);
      throw new ApiError(400, "Reset code has expired");
    }
    if (record.codeHash !== hashResetCode(normalizedEmail, code)) {
      record.attempts += 1;
      throw new ApiError(400, "Invalid reset code");
    }

    const newHash = await bcrypt.hash(newPass, 12);
    await prisma.user.update({
      where: { email: normalizedEmail },
      data: { passwordHash: newHash, refreshHash: null }
    });

    resetCodes.delete(normalizedEmail);
    return { ok: true, message: "Password updated successfully" };
  },

  async listImpersonationTargets(actorUser: AuthUser) {
    const allowedRoles: string[] = ["SUPER_ADMIN", "HR_ADMIN"];
    const isAuthorized = allowedRoles.includes(actorUser.role) || Boolean((actorUser as any).impersonatedBy);
    if (!isAuthorized) {
      throw new ApiError(403, "Access denied. Only administrators can switch accounts.");
    }

    const isSuperAdmin = actorUser.role === "SUPER_ADMIN" || (actorUser as any).impersonatedBy?.role === "SUPER_ADMIN";
    const companyId = actorUser.companyId ?? (actorUser as any).impersonatedBy?.companyId;

    // Determine the real admin's user ID (works whether currently impersonating or not)
    const realAdminUserId = (actorUser as any).impersonatedBy?.id || actorUser.id;

    const employees = await prisma.employee.findMany({
      where: {
        ...(isSuperAdmin ? {} : { companyId: companyId ?? undefined }),
        // Exclude the real admin's own employee record from the list
        user: {
          id: { not: realAdminUserId },
          isActive: true
        }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true
          }
        },
        department: {
          select: {
            id: true,
            name: true,
            code: true
          }
        },
        designation: {
          select: {
            id: true,
            title: true
          }
        },
        documents: {
          where: { type: "PHOTO" },
          select: {
            id: true,
            fileKey: true
          },
          take: 1
        }
      },
      orderBy: [
        { firstName: "asc" },
        { lastName: "asc" }
      ]
    });

    return employees.map((emp) => ({
      id: emp.id,
      employeeCode: emp.employeeCode,
      biometricId: emp.biometricId,
      firstName: emp.firstName,
      middleName: emp.middleName,
      lastName: emp.lastName,
      email: emp.user?.email || emp.personalEmail,
      role: emp.user?.role || "EMPLOYEE",
      isActive: emp.user?.isActive ?? (emp.status === "ACTIVE"),
      userId: emp.user?.id || emp.userId,
      department: emp.department?.name || "General",
      designation: emp.designation?.title || "Team Member",
      photoKey: emp.documents?.[0]?.fileKey || null
    }));
  },

  async impersonateUser(actorUser: AuthUser, target: { targetUserId?: string; targetEmployeeId?: string; targetEmail?: string }) {
    const allowedRoles: string[] = ["SUPER_ADMIN", "HR_ADMIN"];
    const isAuthorized = allowedRoles.includes(actorUser.role) || Boolean((actorUser as any).impersonatedBy);
    if (!isAuthorized) {
      throw new ApiError(403, "Access denied. Only administrators can impersonate users.");
    }

    const originalAdminInfo = (actorUser as any).impersonatedBy || {
      id: actorUser.id,
      email: actorUser.email,
      role: actorUser.role
    };

    let targetUser: any = null;

    if (target.targetUserId) {
      targetUser = await prisma.user.findUnique({
        where: { id: target.targetUserId },
        include: { employee: true }
      });
    }
    
    if (!targetUser && target.targetEmail) {
      targetUser = await prisma.user.findUnique({
        where: { email: target.targetEmail.trim().toLowerCase() },
        include: { employee: true }
      });
    }
    
    if (!targetUser && target.targetEmployeeId) {
      const emp = await prisma.employee.findUnique({
        where: { id: target.targetEmployeeId },
        include: { user: true }
      });
      if (emp?.user) {
        targetUser = { ...emp.user, employee: emp };
      } else if (emp) {
        const empEmail = ((emp as any).workEmail || emp.personalEmail || "").trim().toLowerCase();
        if (empEmail) {
          targetUser = await prisma.user.findUnique({
            where: { email: empEmail },
            include: { employee: true }
          });
        }
      }
    }

    if (!targetUser) {
      throw new ApiError(404, "Target user account not found");
    }

    if (!targetUser.isActive) {
      throw new ApiError(400, "Cannot impersonate an inactive account");
    }

    const payload = {
      id: targetUser.id,
      companyId: targetUser.companyId,
      role: targetUser.role,
      email: targetUser.email,
      impersonatedBy: originalAdminInfo
    };

    const accessToken = signAccessToken(payload as any);
    const refreshToken = signRefreshToken(payload as any);

    try {
      if (targetUser.id) {
        await prisma.user.update({
          where: { id: targetUser.id },
          data: { refreshHash: await bcrypt.hash(refreshToken, 10) }
        });
      }
    } catch (err) {
      console.warn("Failed to store refresh token hash for impersonation:", err);
    }

    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: originalAdminInfo.id,
          action: "AUTH_IMPERSONATE",
          entity: "User",
          entityId: targetUser.id,
          metadata: {
            actorEmail: originalAdminInfo.email,
            targetEmail: targetUser.email,
            targetRole: targetUser.role
          }
        }
      });
    } catch (err) {
      console.warn("Failed to create audit log for impersonation:", err);
    }

    return {
      accessToken,
      refreshToken,
      user: payload,
      originalAdmin: originalAdminInfo
    };
  }
};
