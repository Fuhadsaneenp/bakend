import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";

const signAccessToken = (payload: AuthUser) => jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as any });
const signRefreshToken = (payload: AuthUser) => jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_TTL as any });

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
  }
};
