import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { permissionService } from "../modules/authority/permission.service.js";

export type AuthUser = {
  id: string;
  companyId: string | null;
  role: Role;
  email: string;
  impersonatedBy?: {
    id: string;
    email: string;
    role: string;
    companyId?: string | null;
  };
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
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthUser & { impersonatedBy?: any };
    const dbUser = await prisma.user.findUnique({ where: { id: payload.id } });
    if (dbUser) {
      req.user = {
        id: dbUser.id,
        companyId: dbUser.companyId,
        role: dbUser.role as Role,
        email: dbUser.email,
        impersonatedBy: payload.impersonatedBy
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

export const requirePermission = (permissionCode: string) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new ApiError(401, "Unauthenticated");
      await permissionService.requirePermission(req.user.id, permissionCode, req.user.companyId ? { companyId: req.user.companyId } : undefined);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireAnyPermission = (permissionCodes: string[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new ApiError(401, "Unauthenticated");
      await permissionService.requireAnyPermission(req.user.id, permissionCodes, req.user.companyId ? { companyId: req.user.companyId } : undefined);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireApprovalPermission = (permissionCode: string) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new ApiError(401, "Unauthenticated");
      await permissionService.requireApprovalPermission(req.user.id, permissionCode, req.user.companyId ? { companyId: req.user.companyId } : undefined);
      next();
    } catch (error) {
      next(error);
    }
  };
};
