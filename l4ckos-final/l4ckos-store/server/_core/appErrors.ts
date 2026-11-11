import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

export type PublicAppError = {
  success: false;
  code: string;
  message: string;
  details?: string[];
  status: number;
};

type AppErrorInput = {
  trpcCode: TRPCError["code"];
  appCode: string;
  message: string;
  details?: string[];
};

const INTERNAL_ERROR_MESSAGE = "Ocorreu um erro interno. Tente novamente em instantes.";

function sanitizeDetails(details: unknown): string[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const normalized = details
    .map(item => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);

  return normalized.length > 0 ? normalized : undefined;
}

function getHttpStatusFromTrpcCode(code: TRPCError["code"]): number {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "TOO_MANY_REQUESTS":
      return 429;
    case "SERVICE_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

export function createAppError(input: AppErrorInput): TRPCError {
  const error = new TRPCError({
    code: input.trpcCode,
    message: input.message,
  });

  Object.assign(error, {
    appCode: input.appCode,
    details: sanitizeDetails(input.details),
  });

  return error;
}

function mapZodError(error: ZodError): PublicAppError {
  const details = error.issues
    .map(issue => String(issue.message ?? "").trim())
    .filter(Boolean);

  return {
    success: false,
    code: "INVALID_INPUT",
    message: "Os dados enviados são inválidos.",
    details: details.length > 0 ? details : undefined,
    status: 400,
  };
}

export function getPublicAppError(error: unknown): PublicAppError {
  if (error instanceof ZodError) {
    return mapZodError(error);
  }

  if (error instanceof TRPCError && error.cause instanceof ZodError) {
    return mapZodError(error.cause);
  }

  if (error instanceof TRPCError) {
    const appCode = typeof (error as { appCode?: unknown }).appCode === "string"
      ? String((error as { appCode?: unknown }).appCode)
      : error.code;
    const details = sanitizeDetails((error as { details?: unknown }).details);
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    const isUnavailable = error.code === "SERVICE_UNAVAILABLE";

    return {
      success: false,
      code: appCode,
      message: isInternal ? INTERNAL_ERROR_MESSAGE : isUnavailable ? "Serviço temporariamente indisponível." : error.message,
      details: isInternal || isUnavailable ? undefined : details,
      status: getHttpStatusFromTrpcCode(error.code),
    };
  }

  return {
    success: false,
    code: "INTERNAL_SERVER_ERROR",
    message: INTERNAL_ERROR_MESSAGE,
    status: 500,
  };
}

export function buildApiErrorResponse(input: {
  status: number;
  code: string;
  message: string;
  details?: string[];
}): PublicAppError {
  return {
    success: false,
    code: input.code,
    message: input.message,
    details: sanitizeDetails(input.details),
    status: input.status,
  };
}
