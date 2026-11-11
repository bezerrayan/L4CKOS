import { createAppError } from "../_core/appErrors";
import { EXCLUSIVE_DROP_ERROR_CODES as CODES } from "../../shared/exclusiveDropsV1";
import { ExclusiveError } from "./store";

/** Maps domain errors to stable `data.appError.code` values the storefront reads (never message text). */
export function toTrpcError(error: unknown): unknown {
  if (!(error instanceof ExclusiveError)) return error;
  switch (error.code) {
    case CODES.accessRequired:
      return createAppError({ trpcCode: "FORBIDDEN", appCode: CODES.accessRequired, message: error.message });
    case CODES.quotaExceeded:
      return createAppError({ trpcCode: "CONFLICT", appCode: CODES.quotaExceeded, message: error.message });
    case CODES.dropClosed:
    case CODES.requestWindowClosed:
      return createAppError({ trpcCode: "CONFLICT", appCode: error.code, message: error.message });
    case CODES.codeInvalid:
      return createAppError({ trpcCode: "BAD_REQUEST", appCode: CODES.codeInvalid, message: error.message });
    case CODES.codeRateLimited:
      return createAppError({ trpcCode: "TOO_MANY_REQUESTS", appCode: CODES.codeRateLimited, message: error.message });
    case CODES.unverifiable:
      return createAppError({ trpcCode: "SERVICE_UNAVAILABLE", appCode: CODES.unverifiable, message: error.message });
    case "NOT_FOUND":
      return createAppError({ trpcCode: "NOT_FOUND", appCode: "NOT_FOUND", message: error.message });
    default:
      return createAppError({ trpcCode: "CONFLICT", appCode: error.code, message: error.message });
  }
}
