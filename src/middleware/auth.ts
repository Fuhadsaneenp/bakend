import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export type AuthUser = {
  id: string;
  companyId: string | null;
  role: Role;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return next(new ApiError(401, "Missing access token"));
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthUser;
    const dbUser = await prisma.user.findUnique({ where: { id: payload.id } });
    if (dbUser) {
      req.user = {
        id: dbUser.id,
        companyId: dbUser.companyId,
        role: dbUser.role as Role,
        email: dbUser.email
      };
    } else {
      req.user = payload;
    }
    next();
  } catch (error) {
    next(new ApiError(401, "Invalid or expired access token"));
  }
};

export const requireRoles = (...roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, "Unauthenticated"));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, "Insufficient permissions"));
    next();
  };
};
