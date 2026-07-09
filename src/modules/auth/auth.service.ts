import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";

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
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new ApiError(404, "User with this email does not exist");

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(email.toLowerCase(), {
      code,
      expires: Date.now() + 15 * 60 * 1000
    });

    console.log("\n=========================================");
    console.log(`[PASSWORD RESET CODE] Reset PIN for ${email} is: ${code}`);
    console.log("=========================================\n");

    try {
      fs.writeFileSync("/Users/saneen/Personal/hr-saas-platform/reset-pin.txt", `Reset PIN code for ${email} is: ${code}\nGenerated at: ${new Date().toLocaleString()}\n`);
    } catch (e) {
      console.error("Failed to write reset-pin.txt:", e);
    }

    return { ok: true, message: "A 6-digit reset code has been printed to the server logs and written to reset-pin.txt." };
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
    try {
      if (fs.existsSync("/Users/saneen/Personal/hr-saas-platform/reset-pin.txt")) {
        fs.unlinkSync("/Users/saneen/Personal/hr-saas-platform/reset-pin.txt");
      }
    } catch (e) {
      console.error("Failed to delete reset-pin.txt:", e);
    }
    return { ok: true, message: "Password updated successfully" };
  }
};
