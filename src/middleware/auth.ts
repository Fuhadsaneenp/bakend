import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";

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

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) throw new ApiError(401, "Missing access token");

  try {
    req.user = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthUser;
    next();
  } catch {
    throw new ApiError(401, "Invalid or expired access token");
  }
};

export const requireRoles = (...roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new ApiError(401, "Unauthenticated");
    if (!roles.includes(req.user.role)) throw new ApiError(403, "Insufficient permissions");
    next();
  };
};
