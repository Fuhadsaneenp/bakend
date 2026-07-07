export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const notFound = (entity: string) => new ApiError(404, `${entity} not found`);
