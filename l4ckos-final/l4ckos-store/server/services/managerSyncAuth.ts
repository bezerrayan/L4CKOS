import {
  timingSafeEqual,
} from "node:crypto";

export function isManagerSyncAuthorizationValid(
  authorizationHeader:
    string | undefined,
  expectedToken:
    string | undefined,
) {
  const expected =
    expectedToken?.trim();

  if (
    !expected ||
    expected.length < 32
  ) {
    return false;
  }

  const match =
    /^Bearer\s+(.+)$/i.exec(
      authorizationHeader ??
        "",
    );

  if (!match) {
    return false;
  }

  const supplied =
    match[1]?.trim();

  if (!supplied) {
    return false;
  }

  const suppliedBuffer =
    Buffer.from(
      supplied,
      "utf8",
    );

  const expectedBuffer =
    Buffer.from(
      expected,
      "utf8",
    );

  if (
    suppliedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    suppliedBuffer,
    expectedBuffer,
  );
}
