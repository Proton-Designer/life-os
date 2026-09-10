#!/usr/bin/env python3
"""
Static detector for the ONE bug class AGENTS.md says nothing else catches:
a Server Component passing a function prop to a Client Component.

Why this exists: `tsc --noEmit` and the whole vitest suite are structurally
blind to it (jsdom does not enforce the RSC serialization boundary), and the
only lint plugin in the ecosystem checks directive placement, not prop
serializability. This repo has shipped the bug twice with everything green.

What it does:
  1. Collect every component exported from a file carrying "use client".
  2. Scan every file WITHOUT "use client" for JSX that renders one of them.
  3. Report props whose value is a function.

Two severities, because they are genuinely different:
  ERROR  - an inline arrow / function expression / .bind-less closure.
           These CANNOT cross the boundary. Always a bug.
  REVIEW - an identifier whose value we cannot resolve statically.
           Fine if it is a Server Action reference (or `action.bind(null,x)`),
           a bug if it is a plain local function. Needs a human/agent look.

Exit 1 on any ERROR. Exit 0 with REVIEW lines printed (they are advisory).
"""
import os, re, sys, json

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAN_DIRS = ["app", "components", "lib"]
SKIP_PARTS = {"node_modules", ".next", "__tests__", "e2e", ".git"}

def iter_files():
    for d in SCAN_DIRS:
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, d)):
            dirnames[:] = [x for x in dirnames if x not in SKIP_PARTS]
            for fn in filenames:
                if fn.endswith((".tsx", ".ts")):
                    yield os.path.join(dirpath, fn)

def has_use_client(src):
    # Directive must be at the top, before any real statement.
    for line in src.splitlines():
        s = line.strip()
        if not s or s.startswith("//") or s.startswith("/*") or s.startswith("*"):
            continue
        return s.startswith('"use client"') or s.startswith("'use client'")
    return False

def has_use_server(src):
    for line in src.splitlines():
        s = line.strip()
        if not s or s.startswith("//") or s.startswith("/*") or s.startswith("*"):
            continue
        return s.startswith('"use server"') or s.startswith("'use server'")
    return False

EXPORT_RE = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)",
    re.M,
)


def _read_tag_attrs(src, i):
    """Return the attribute text of a JSX opening tag starting at index i.

    Tracks brace depth and quote/template state so that '>' inside an arrow
    function, a string, or a nested expression does not end the tag.
    """
    depth = 0
    quote = None
    out = []
    n = len(src)
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\":
                if i + 1 < n:
                    out.append(src[i + 1]); i += 2; continue
            elif c == quote:
                quote = None
            i += 1
            continue
        if c in "\"'`":
            quote = c; out.append(c); i += 1; continue
        if c == "{":
            depth += 1; out.append(c); i += 1; continue
        if c == "}":
            depth -= 1; out.append(c); i += 1; continue
        if c == ">" and depth == 0:
            # '=>' at depth 0 cannot occur in valid JSX attrs, but guard anyway
            if out and out[-1] == "=":
                out.append(c); i += 1; continue
            return "".join(out)
        out.append(c); i += 1
    return None


def _read_attrs(attrs):
    """Yield (prop, expression) for every `prop={...}` in an attribute blob."""
    i, n = 0, len(attrs)
    while i < n:
        m = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{").search(attrs, i)
        if not m:
            return
        prop = m.group(1)
        j = m.end()
        depth, quote, start = 1, None, j
        while j < n and depth:
            c = attrs[j]
            if quote:
                if c == "\\":
                    j += 2; continue
                if c == quote:
                    quote = None
            elif c in "\"'`":
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            j += 1
        yield prop, attrs[start : j - 1].strip()
        i = j



def _paren_then_arrow(val):
    """True only if val is `(...) => ...` -- a real arrow, not a call."""
    i = val.index("(")
    depth, quote, n = 0, None, len(val)
    while i < n:
        c = val[i]
        if quote:
            if c == "\\":
                i += 2; continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return val[i + 1 :].lstrip().startswith("=>")
        i += 1
    return False


def _classify(val, server_actions, local_funcs, prop):
    """error = cannot cross the boundary. review = unresolvable. None = fine."""
    if ".bind(" in val:
        return None                      # bound Server Action: the sanctioned fix
    # inline arrow / function expression, at any depth
    if re.match(r"^(async\s*)?\(", val) and _paren_then_arrow(val):
        return "error"
    if re.match(r"^(async\s+)?function\b", val):
        return "error"
    if re.match(r"^(async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*=>", val):
        return "error"
    if re.match(r"^[A-Za-z_][A-Za-z0-9_.]*$", val):
        base = val.split(".")[0]
        if base in server_actions:
            return None                  # Server Action reference: legal
        if base in local_funcs:
            return "error"               # plain local closure: the Phase E bug
        if re.match(r"^(on|get|render|handle)[A-Z]", prop) or \
           prop.endswith(("Fn", "Format", "Formatter", "Callback", "Handler")):
            return "review"
    return None


LOCAL_FUNC_RE = re.compile(
    r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*"
    r"(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>|"
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)",
    re.M,
)


def _local_funcs(src):
    out = set()
    for m in LOCAL_FUNC_RE.finditer(src):
        out.add(m.group(1) or m.group(2))
    return out


def main():
    client_components = {}   # name -> file
    server_action_files = set()
    files = list(iter_files())
    srcs = {}
    for f in files:
        try:
            srcs[f] = open(f, encoding="utf-8").read()
        except Exception:
            continue

    for f, src in srcs.items():
        if has_use_client(src):
            for m in EXPORT_RE.finditer(src):
                client_components.setdefault(m.group(1), f)
        if has_use_server(src):
            server_action_files.add(f)

    # Every symbol exported from a "use server" file: legal to pass across.
    server_actions = set()
    for f in server_action_files:
        for m in re.finditer(r"^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)", srcs[f], re.M):
            server_actions.add(m.group(1))

    errors, reviews = [], []

    for f, src in srcs.items():
        if has_use_client(src) or has_use_server(src):
            continue  # only Server Components are subject to the boundary
        rel = os.path.relpath(f, ROOT)
        local_funcs = _local_funcs(src)

        # Which client components does this file actually import?
        imported = set()
        for m in re.finditer(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from", src):
            for part in m.group(1).split(","):
                name = part.strip().split(" as ")[-1].strip()
                if name in client_components:
                    imported.add(name)
        for m in re.finditer(r"import\s+([A-Z][A-Za-z0-9_]*)\s+from", src):
            if m.group(1) in client_components:
                imported.add(m.group(1))
        if not imported:
            continue

        # Walk each JSX opening tag for those components.
        #
        # NOTE: do NOT regex this with [^>]*? to find the closing bracket.
        # An arrow function CONTAINS '>', so that pattern terminates the tag
        # in the middle of `(n) => ...` and the inline-arrow case -- the most
        # important one, and one of the two incidents in AGENTS.md -- becomes
        # structurally invisible. Proven: the first version of this script
        # reported the Phase D fixture clean. Scan with brace/quote state.
        for name in imported:
            for tm in re.finditer(r"<" + re.escape(name) + r"(?=[\s/>])", src):
                attrs = _read_tag_attrs(src, tm.end())
                if attrs is None:
                    continue
                line_no = src[: tm.start()].count("\n") + 1
                for prop, val in _read_attrs(attrs):
                    entry = (rel, line_no, name, prop, val[:90].replace("\n", " "))
                    kind = _classify(val, server_actions, local_funcs, prop)
                    if kind == "error":
                        errors.append(entry)
                    elif kind == "review":
                        reviews.append(entry)

    print(f"scanned {len(srcs)} files; {len(client_components)} client components known; "
          f"{len(server_actions)} server actions known\n")

    if errors:
        print("ERROR - function value cannot cross the RSC boundary:")
        for rel, ln, comp, prop, val in errors:
            print(f"  {rel}:{ln}  <{comp} {prop}={{{val}}}>")
        print()
    if reviews:
        print("REVIEW - identifier-valued prop, not resolvable statically:")
        for rel, ln, comp, prop, val in reviews:
            print(f"  {rel}:{ln}  <{comp} {prop}={{{val}}}>")
        print()
    if not errors and not reviews:
        print("clean: no function props cross a Server->Client boundary")

    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
