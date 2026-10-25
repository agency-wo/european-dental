#!/usr/bin/env python3
"""Run every gate for this site in one command, and prove that it ran.

WHY THIS FILE EXISTS. The gates were correct and there was no single way to run them, so
the sequence got retyped from memory each time. A retyped sequence silently drops a step:
a build here once ran with one generator missing and the gate stayed green throughout,
which is why the build has a single entry point. This is the same fix applied to the
checks. A hand-assembled chain also cannot answer "did everything run?" afterwards, and a
chain joined by && stops at the first failure, so one broken gate hides the state of the
rest.

Read-only. It runs the project's own gates and writes nothing itself.

USAGE
  python _tools/gates.py              the read-only gates: fast, no browser, no network
  python _tools/gates.py --build      build first, and assert a rerun is byte-identical
  python _tools/gates.py --browser    also the gates that drive a real browser
  python _tools/gates.py --all        --build and --browser together
  python _tools/gates.py --list       show what would run, and run nothing

EXIT. 0 only when every gate selected actually ran and passed. Any failure, any missing
tool, exit 1. A gate that is absent is a failure, not a skip: that is the whole point.

WHY THE BROWSER GATES ARE OPT-IN. They need the installed browser, so they are a local
step and cannot run on a hosted runner. Keeping them behind a flag means the default set
is the one that always works, and nobody learns to ignore a red default.

WHY SOME TOOLS ARE NOT HERE. live-check.mjs probes the deployed site over the network, so
it is a post-deploy check rather than a gate on the working tree. The image, font and
brand tools generate committed assets and are run by hand. serve.mjs and shot.mjs are
instruments, not checks.
"""
import argparse
import hashlib
import os
import subprocess
import sys
import time

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
SITE = os.path.join(ROOT, "site")

# name, argv. Order is cheapest-and-most-fundamental first, so the common failure
# surfaces before the slow gates run.
READONLY = [
    ("verify.py",              [sys.executable, "verify.py"]),
    ("check-placeholders.mjs", ["node", "check-placeholders.mjs"]),
    ("check-images.mjs",       ["node", "check-images.mjs"]),
    ("contrast.py",            [sys.executable, "contrast.py"]),
]

BROWSER = [
    ("smoke.mjs",              ["node", "smoke.mjs"]),
    ("weigh.mjs",              ["node", "weigh.mjs"]),
]


def html_fingerprint():
    """Hash every built page, so a rebuild can be proved byte-identical."""
    h = hashlib.sha256()
    for dirpath, _dirs, files in os.walk(SITE):
        for fn in sorted(files):
            if fn.endswith(".html"):
                p = os.path.join(dirpath, fn)
                h.update(os.path.relpath(p, SITE).replace(os.sep, "/").encode())
                with open(p, "rb") as f:
                    h.update(f.read())
    return h.hexdigest()


def run(name, argv):
    """Run one gate from the tools directory. Returns (ok, seconds, tail)."""
    t0 = time.time()
    try:
        p = subprocess.run(argv, cwd=TOOLS, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=600)
    except FileNotFoundError:
        return False, time.time() - t0, ["tool or interpreter not found: " + argv[0]]
    except subprocess.TimeoutExpired:
        return False, time.time() - t0, ["timed out after 600s"]
    out = ((p.stdout or "") + (p.stderr or "")).strip().splitlines()
    return p.returncode == 0, time.time() - t0, out[-15:]


def build_and_check_determinism(results):
    print("  %-24s " % "build.mjs", end="", flush=True)
    t0 = time.time()
    before = html_fingerprint() if os.path.isdir(SITE) else None
    ok, secs, tail = run("build.mjs", ["node", "build.mjs"])
    if not ok:
        print("FAIL  %5.1fs" % secs)
        for ln in tail:
            print("      " + ln)
        results.append(("build.mjs", False))
        return False
    first = html_fingerprint()
    ok2, secs2, tail2 = run("build.mjs", ["node", "build.mjs"])
    second = html_fingerprint() if ok2 else None
    total = time.time() - t0
    if not ok2 or first != second:
        print("FAIL  %5.1fs  rebuild is not byte-identical" % total)
        results.append(("build.mjs", False))
        return False
    note = "" if before is None else ("  (pages changed)" if before != first else "  (no change)")
    print("PASS  %5.1fs  deterministic%s" % (total, note))
    results.append(("build.mjs", True))
    return True


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--browser", action="store_true", help="also run the browser gates")
    ap.add_argument("--build", action="store_true", help="build first, assert determinism")
    ap.add_argument("--all", action="store_true", help="--build and --browser")
    ap.add_argument("--list", action="store_true", help="show what would run")
    a = ap.parse_args()
    want_build = a.build or a.all
    want_browser = a.browser or a.all

    selected = list(READONLY) + (BROWSER if want_browser else [])

    if a.list:
        if want_build:
            print("  build.mjs  (twice, to assert determinism)")
        for name, argv in selected:
            print("  " + name)
        if not want_browser:
            print("  (browser gates withheld; pass --browser for: %s)"
                  % ", ".join(n for n, _ in BROWSER))
        return 0

    print("gates: %d to run%s" % (len(selected) + (1 if want_build else 0),
                                  "" if want_browser else "  (browser gates withheld)"))

    results = []
    if want_build and not build_and_check_determinism(results):
        print("\nbuild failed; gates not run")
        print("GATES FAIL")
        return 1

    for name, argv in selected:
        if not os.path.exists(os.path.join(TOOLS, name)):
            print("  %-24s FAIL   missing from _tools" % name)
            results.append((name, False))
            continue
        print("  %-24s " % name, end="", flush=True)
        ok, secs, tail = run(name, argv)
        print(("PASS  " if ok else "FAIL  ") + "%5.1fs" % secs)
        if not ok:
            for ln in tail:
                print("      " + ln)
        results.append((name, ok))

    bad = [n for n, ok in results if not ok]
    print("\n%d of %d passed" % (len(results) - len(bad), len(results)))
    if bad:
        for n in bad:
            print("  failed: " + n)
        print("GATES FAIL")
        return 1
    print("GATES PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
