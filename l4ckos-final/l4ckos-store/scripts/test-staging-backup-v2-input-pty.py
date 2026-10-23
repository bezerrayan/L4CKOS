#!/usr/bin/env python3
"""Exercise the protected Bash-to-Node key path under a real PTY, with no services."""

import os
import pty
import re
import select
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts/run-staging-backup-v2.sh"
REAL_NODE = shutil.which("node")
if not REAL_NODE:
    raise SystemExit("NODE_NOT_FOUND")


def read_until(fd, marker, timeout=20):
    data = bytearray()
    end = time.monotonic() + timeout
    while marker not in data:
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise AssertionError("PTY_MARKER_TIMEOUT")
        ready, _, _ = select.select([fd], [], [], remaining)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError as error:
            if error.errno == 5:
                break
            raise
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


def run_pty_case(bin_dir, value, expected, expected_status, enter=b"\r"):
    child, master = pty.fork()
    if child == 0:
        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
        os.chdir(ROOT)
        os.execve("/bin/bash", ["bash", str(WRAPPER)], env)

    transcript = bytearray()
    try:
        transcript.extend(read_until(master, "referência Bitwarden l4ckos-staging-aes-v2: ".encode()))
        os.write(master, value.encode("ascii") + enter)
        marker = b"BACKUP_V2_KEY_INPUT_ACCEPTED" if expected == "accepted" else expected.encode("ascii")
        transcript.extend(read_until(master, marker))
        _, status = os.waitpid(child, 0)
        code = os.waitstatus_to_exitcode(status)
        if marker not in transcript:
            if value.encode("ascii") in transcript:
                raise AssertionError("PTY_KEY_WAS_ECHOED")
            diagnostic = re.search(rb'"phase":"([a-z_]+)".*?"code":"([A-Z0-9_:-]+)"', transcript)
            if diagnostic:
                raise AssertionError("PTY_CHILD_DIAGNOSTIC_" + diagnostic.group(1).decode() + "_" + diagnostic.group(2).decode())
            facts = [
                label for marker, label in [
                    (b"BACKUP_V2_RC_CHECKOUT_READY", "preflight"),
                    (b"BACKUP_V2_KEY_INPUT_ACCEPTED", "accepted"),
                    (b"PTY_TEST_SHIM_CAPTURE", "shim_capture"),
                    (b"INVALID_KEY_FORMAT", "invalid"),
                    (b"INPUT_READ_FAILED", "read_failed"),
                    (b"STAGING_BACKUP_V2_FAILED", "backup_failed"),
                ] if marker in transcript
            ]
            raise AssertionError(f"PTY_EXPECTED_MARKER_MISSING_EXIT_{code}_{'_'.join(facts) or 'no_marker'}")
        if code != expected_status:
            raise AssertionError("PTY_UNEXPECTED_EXIT_STATUS")
        if value.encode("ascii") in transcript:
            raise AssertionError("PTY_KEY_WAS_ECHOED")
        return bytes(transcript)
    finally:
        try:
            os.close(master)
        except OSError:
            pass
        try:
            os.kill(child, signal.SIGKILL)
        except ProcessLookupError:
            pass


def main():
    with tempfile.TemporaryDirectory(prefix="l4ckos-backup-v2-pty-") as temp:
        bin_dir = Path(temp) / "bin"
        bin_dir.mkdir(mode=0o700)
        shim = bin_dir / "node"
        shim.write_text(
            "#!/usr/bin/python3\n"
            "import os, sys\n"
            f"real = {REAL_NODE!r}\n"
            "args = sys.argv[1:]\n"
            "if 'capture' in args:\n"
            "    os.write(1, b'PTY_TEST_SHIM_CAPTURE\\n')\n"
            "    os.execv(real, [real, '--import', 'tsx', 'scripts/staging-backup-v2.ts', 'test-key-input'])\n"
            "os.execv(real, [real, *args])\n",
            encoding="utf-8",
        )
        shim.chmod(0o700)

        valid = "aB0123456789" * 5 + "aB01"  # exactly 64 hex characters
        if len(valid) != 64:
            raise AssertionError("SYNTHETIC_KEY_FIXTURE_INVALID")
        accepted = run_pty_case(bin_dir, valid, "accepted", 0, enter=b"\r\n")
        if b'"phase":"key_input_complete"' not in accepted:
            raise AssertionError("VALID_INPUT_DID_NOT_ADVANCE")

        rejected = run_pty_case(bin_dir, valid[:-1], "INVALID_KEY_FORMAT", 2)
        if b'"phase":"key_input"' not in rejected:
            raise AssertionError("INVALID_INPUT_DIAGNOSTIC_MISSING")

        empty_child, empty_master = pty.fork()
        if empty_child == 0:
            env = os.environ.copy()
            env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
            os.chdir(ROOT)
            os.execve("/bin/bash", ["bash", str(WRAPPER)], env)
        try:
            read_until(empty_master, "referência Bitwarden l4ckos-staging-aes-v2: ".encode())
            os.write(empty_master, b"\x04")
            eof_output = read_until(empty_master, b"INPUT_READ_FAILED")
            _, status = os.waitpid(empty_child, 0)
            if os.waitstatus_to_exitcode(status) != 2 or b"INPUT_READ_FAILED" not in eof_output:
                raise AssertionError("EOF_NOT_CLASSIFIED")
        finally:
            os.close(empty_master)
            try:
                os.kill(empty_child, signal.SIGKILL)
            except ProcessLookupError:
                pass

        no_tty = subprocess.run(
            ["bash", str(WRAPPER)], cwd=ROOT,
            env={**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}"},
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=20, check=False,
        )
        if no_tty.returncode != 2 or b"TTY_UNAVAILABLE" not in no_tty.stdout:
            raise AssertionError("MISSING_TTY_NOT_CLASSIFIED")

        closed_fd = subprocess.run(
            ["/bin/bash", "-c", "node --import tsx scripts/staging-backup-v2.ts test-key-input 3<&-"],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20, check=False,
        )
        if closed_fd.returncode != 1 or b'"code":"INPUT_READ_FAILED"' not in closed_fd.stdout:
            raise AssertionError("CLOSED_FD_NOT_CLASSIFIED")

    print('{"status":"BACKUP_V2_PTY_INPUT_TESTS_PASSED","cases":["valid-no-echo-fd3-to-node-crlf","invalid-format","eof-read-failure","tty-unavailable","closed-fd-read-failure","services-not-invoked"]}')


if __name__ == "__main__":
    main()
