import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getAllowedMethodsForApiPath,
} from "../_core/httpApi";

import {
  isManagerSyncAuthorizationValid,
} from "../services/managerSyncAuth";

describe(
  "manager sync security",
  () => {
    const token =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    it(
      "accepts the exact bearer token",
      () => {
        expect(
          isManagerSyncAuthorizationValid(
            `Bearer ${token}`,
            token,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "accepts bearer scheme case-insensitively",
      () => {
        expect(
          isManagerSyncAuthorizationValid(
            `bearer ${token}`,
            token,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects missing and incorrect credentials",
      () => {
        expect(
          isManagerSyncAuthorizationValid(
            undefined,
            token,
          ),
        ).toBe(
          false,
        );

        expect(
          isManagerSyncAuthorizationValid(
            "Bearer wrong",
            token,
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects weak server configuration",
      () => {
        expect(
          isManagerSyncAuthorizationValid(
            "Bearer short",
            "short",
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "exposes only GET in the HTTP method policy",
      () => {
        expect(
          getAllowedMethodsForApiPath(
            "/api/internal/manager/sync",
          ),
        ).toEqual([
          "GET",
        ]);
      },
    );
  },
);
