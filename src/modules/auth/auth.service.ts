import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { emailService } from "../../integrations/email/email.service.js";

const signAccessToken = (payload: AuthUser) => jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as any });
const signRefreshToken = (payload: AuthUser) => jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_TTL as any });

const resetCodes = new Map<string, { code: string; expires: number }>();

export const authService = {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new ApiError(401, "Invalid credentials");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError(401, "Invalid credentials");

    const payload = { id: user.id, companyId: user.companyId, role: user.role, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    await prisma.user.update({ where: { id: user.id }, data: { refreshHash: await bcrypt.hash(refreshToken, 10) } });
    return { accessToken, refreshToken, user: payload };
  },

  async refresh(refreshToken: string) {
    const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as AuthUser;
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user?.refreshHash || !(await bcrypt.compare(refreshToken, user.refreshHash))) {
      throw new ApiError(401, "Invalid refresh token");
    }
    const freshPayload = { id: user.id, companyId: user.companyId, role: user.role, email: user.email };
    return { accessToken: signAccessToken(freshPayload) };
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
    if (!user) throw new ApiError(404, "User with this email does not exist");

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(normalizedEmail, {
      code,
      expires: Date.now() + 15 * 60 * 1000
    });

    const emailResult = await emailService.send({
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

    if (!emailResult.delivered) {
      console.log("\n=========================================");
      console.log(`[PASSWORD RESET CODE] Reset PIN for ${user.email} is: ${code}`);
      console.log("SMTP is not configured, so the reset PIN was not emailed.");
      console.log("=========================================\n");
    }

    return {
      ok: true,
      message: emailResult.delivered
        ? "A 6-digit reset code has been sent to your email."
        : "Email sending is not configured on the server. The reset code was printed to the backend logs."
    };
  },

  async resetPassword(email: string, code: string, newPass: string) {
    const record = resetCodes.get(email.toLowerCase());
    if (!record) throw new ApiError(400, "No password reset requested for this email");

    if (record.code !== code) throw new ApiError(400, "Invalid reset code");
    if (Date.now() > record.expires) {
      resetCodes.delete(email.toLowerCase());
      throw new ApiError(400, "Reset code has expired");
    }

    const newHash = await bcrypt.hash(newPass, 12);
    await prisma.user.update({
      where: { email: email.toLowerCase() },
      data: { passwordHash: newHash, refreshHash: null }
    });

    resetCodes.delete(email.toLowerCase());
    return { ok: true, message: "Password updated successfully" };
  }
};
