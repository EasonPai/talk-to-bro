#!/usr/bin/env python3
"""
Antigravity CLI Status Line Formatter
Parses JSON status from stdin and outputs formatted, colorized status line.
"""

import argparse
import json
import os
import subprocess
import sys

def safe_dict(val) -> dict:
    """Return val if it is a dictionary, otherwise return an empty dictionary."""
    return val if isinstance(val, dict) else {}

def safe_int(val, default: int = 0) -> int:
    """Safely convert value to int with fallback default."""
    try:
        if val is None:
            return default
        return int(val)
    except (ValueError, TypeError):
        return default

def safe_float(val, default: float = 0.0) -> float:
    """Safely convert value to float with fallback default."""
    try:
        if val is None:
            return default
        return float(val)
    except (ValueError, TypeError):
        return default

def format_tokens(n: int) -> str:
    """Format token numbers into human-readable compact notation (k, M)."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)

def format_cost(usd: float) -> str:
    """Format USD cost to 4 decimal places for < $1.00, or 2 decimal places otherwise."""
    if usd <= 0:
        return "$0.00"
    if usd < 1.0:
        return f"${usd:.4f}"
    return f"${usd:.2f}"

def inspect_process_tree(max_depth: int = 4) -> tuple[bool, str]:
    """
    Inspect parent/ancestor processes to detect YOLO mode (--dangerously-skip-permissions)
    and execution mode (--mode).
    Returns (is_yolo, mode).
    """
    if os.environ.get("AGY_STATUSLINE_DISABLE_PROCESS_INSPECTION") == "1":
        return False, ""

    is_yolo = False
    mode = ""
    try:
        pid = os.getppid()
        for _ in range(max_depth):
            if pid <= 1:
                break
            res = subprocess.run(
                ["ps", "-o", "ppid=,args=", "-p", str(pid)],
                capture_output=True,
                text=True,
                timeout=0.3,
            )
            if res.returncode != 0 or not res.stdout.strip():
                break
            line = res.stdout.strip()
            parts = line.split(None, 1)
            ppid_str = parts[0]
            args_str = parts[1] if len(parts) > 1 else ""

            # Check for YOLO / bypass permissions
            if "--dangerously-skip-permissions" in args_str or "--yolo" in args_str:
                is_yolo = True

            # Check for --mode
            if not mode and "--mode" in args_str:
                tokens = args_str.split()
                for i, tok in enumerate(tokens):
                    if tok.startswith("--mode="):
                        mode = tok.split("=", 1)[1].strip()
                        break
                    elif tok == "--mode" and i + 1 < len(tokens):
                        mode = tokens[i + 1].strip()
                        break

            try:
                pid = int(ppid_str)
            except ValueError:
                break
    except Exception:
        pass
    return is_yolo, mode

def is_yolo_active(data: dict) -> bool:
    """
    Check if YOLO / bypass-permissions mode is active.
    First checks explicit payload flags, then falls back to inspecting ancestor process args.
    """
    if isinstance(data, dict):
        if data.get("yolo") is True or data.get("dangerously_skip_permissions") is True:
            return True

        perm_mode = data.get("permission_mode") or data.get("permissionMode")
        if isinstance(perm_mode, str):
            if perm_mode.strip().lower() in ("bypasspermissions", "bypass_permissions", "yolo"):
                return True

        raw_mode = (
            data.get("mode")
            or data.get("agent_mode")
            or data.get("agentMode")
            or safe_dict(data.get("agent")).get("mode")
        )
        if isinstance(raw_mode, str) and raw_mode.strip().lower() in ("yolo", "bypasspermissions", "bypass_permissions"):
            return True

    # Fallback: inspect ancestor processes
    is_yolo, _ = inspect_process_tree()
    return is_yolo

def format_yolo_badge(no_color: bool = False) -> str:
    """Format and colorize YOLO mode badge."""
    if no_color:
        return "⚡ YOLO"
    # Bold bright yellow
    return "\033[1;33m⚡ YOLO\033[0m"

def resolve_agent_mode(data: dict) -> str:
    """
    Resolve agent execution mode (e.g. plan, accept-edits, auto, default).
    Excludes pure transient runtime states like 'working' or 'idle',
    and excludes YOLO which is handled by is_yolo_active / format_yolo_badge.
    """
    if isinstance(data, dict):
        raw_mode = (
            data.get("mode")
            or data.get("agent_mode")
            or data.get("agentMode")
            or safe_dict(data.get("agent")).get("mode")
        )
        if raw_mode and isinstance(raw_mode, str):
            clean = raw_mode.strip()
            if clean.lower() not in ("yolo", "bypasspermissions", "bypass_permissions"):
                return clean

        perm_mode = data.get("permission_mode") or data.get("permissionMode")
        if perm_mode and isinstance(perm_mode, str):
            clean = perm_mode.strip()
            if clean.lower() not in ("bypasspermissions", "bypass_permissions", "yolo"):
                return clean

    # Fallback to process args for --mode
    _, cli_mode = inspect_process_tree()
    if cli_mode and cli_mode.lower() not in ("default", "standard"):
        return cli_mode.lower()

    return ""

def format_agent_mode(mode: str, no_color: bool = False) -> str:
    """Format and colorize agent mode badge."""
    if not mode:
        return ""

    mode_lower = mode.lower()

    # ANSI color codes
    if no_color:
        c_cyan = c_green = c_yellow = c_magenta = c_reset = c_dim = ""
    else:
        c_cyan = "\033[36m"
        c_green = "\033[32m"
        c_yellow = "\033[33m"
        c_magenta = "\033[35m"
        c_dim = "\033[2m"
        c_reset = "\033[0m"

    icon = "⚙"
    color = c_dim

    if mode_lower in ("plan", "planning"):
        icon = "📋"
        color = c_cyan
    elif mode_lower in ("accept-edits", "acceptedits", "edit", "edits"):
        icon = "✏"
        color = c_green
    elif mode_lower in ("auto", "autonomous"):
        icon = "🤖"
        color = c_magenta
    elif mode_lower in ("yolo", "bypasspermissions", "bypass_permissions"):
        return format_yolo_badge(no_color=no_color)
    elif mode_lower in ("default", "standard"):
        icon = "⚙"
        color = c_dim

    return f"{color}{icon} {mode}{c_reset}"

def resolve_git_info(data: dict) -> tuple[str, bool]:
    """Resolve branch and dirty status from payload or fallback to git command."""
    if not isinstance(data, dict):
        return "", False

    vcs = safe_dict(data.get("vcs"))
    branch = vcs.get("branch")
    dirty = bool(vcs.get("dirty", False))
    if branch:
        return str(branch), dirty

    workspace = safe_dict(data.get("workspace"))
    target_dir = (
        workspace.get("current_dir")
        or workspace.get("project_dir")
        or data.get("cwd")
    )
    if target_dir and isinstance(target_dir, str):
        try:
            res = subprocess.run(
                ["git", "-C", target_dir, "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True,
                text=True,
                timeout=0.5,
            )
            if res.returncode == 0 and res.stdout.strip():
                branch = res.stdout.strip()
                status_res = subprocess.run(
                    ["git", "-C", target_dir, "status", "--porcelain"],
                    capture_output=True,
                    text=True,
                    timeout=0.5,
                )
                dirty = bool(status_res.stdout.strip())
                return branch, dirty
        except Exception:
            pass
    return "", False

def render_status(data: dict, no_color: bool = False, separator: str = " | ") -> str:
    if not isinstance(data, dict):
        data = {}

    # ANSI color codes
    if no_color:
        c_cyan = c_green = c_yellow = c_magenta = c_reset = c_dim = ""
    else:
        c_cyan = "\033[36m"
        c_green = "\033[32m"
        c_yellow = "\033[33m"
        c_magenta = "\033[35m"
        c_dim = "\033[2m"
        c_reset = "\033[0m"

    parts = []

    # 1. Model Info
    model_obj = safe_dict(data.get("model"))
    model_name = model_obj.get("display_name") or model_obj.get("name") or "Unknown Model"
    parts.append(f"{c_cyan}[{model_name}]{c_reset}")

    # 2. YOLO Mode Badge (prominent auto-approve indicator)
    if is_yolo_active(data):
        parts.append(format_yolo_badge(no_color=no_color))

    # 3. Agent Running Mode (if present and distinct from YOLO)
    agent_mode = resolve_agent_mode(data)
    if agent_mode:
        parts.append(format_agent_mode(agent_mode, no_color=no_color))

    # 4. VCS / Git Branch
    branch, dirty = resolve_git_info(data)
    if branch:
        dirty_marker = "*" if dirty else ""
        parts.append(f"{c_green} {branch}{dirty_marker}{c_reset}")

    # 3. Subagents & Background Tasks (if present)
    subagents = data.get("subagents") or data.get("tasks") or []
    if isinstance(subagents, list) and len(subagents) > 0:
        parts.append(f"{c_magenta}⚡ {len(subagents)} subagents{c_reset}")

    # 4. Context & Output Tokens
    context_win = safe_dict(data.get("context_window"))
    usage = safe_dict(data.get("current_usage")) or safe_dict(data.get("usage"))
    curr_usage_in_cw = safe_dict(context_win.get("current_usage"))

    in_tokens = (
        context_win.get("total_input_tokens")
        or curr_usage_in_cw.get("input_tokens")
        or usage.get("input_tokens")
        or 0
    )
    in_tokens = safe_int(in_tokens, 0)

    out_tokens = (
        context_win.get("total_output_tokens")
        or curr_usage_in_cw.get("output_tokens")
        or usage.get("output_tokens")
        or 0
    )
    out_tokens = safe_int(out_tokens, 0)

    used_pct_val = context_win.get("used_percentage")
    used_pct = safe_float(used_pct_val) if used_pct_val is not None else None

    in_fmt = format_tokens(in_tokens)
    out_fmt = format_tokens(out_tokens)

    if used_pct is not None and used_pct > 0:
        parts.append(f"Ctx: {c_yellow}{in_fmt} in{c_reset} / {out_fmt} out ({used_pct:.1f}%)")
    else:
        parts.append(f"Ctx: {c_yellow}{in_fmt} in{c_reset} / {out_fmt} out")

    # 5. Cost
    cost = safe_float(usage.get("total_usd"), 0.0)
    sub_cost = safe_float(usage.get("subagent_usd"), 0.0)
    if cost > 0:
        cost_str = format_cost(cost)
        if sub_cost > 0:
            parts.append(f"{c_dim}{cost_str} (+{format_cost(sub_cost)} sub){c_reset}")
        else:
            parts.append(f"{cost_str}")

    return separator.join(parts)

def main():
    parser = argparse.ArgumentParser(description="Antigravity Statusline Formatter")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color output")
    parser.add_argument("--separator", default=" | ", help="Separator between status components")
    args = parser.parse_args()

    try:
        # Read stdin
        raw_input = sys.stdin.read().strip()
        if not raw_input:
            data = {}
        else:
            try:
                data = json.loads(raw_input)
            except Exception:
                data = {}

        output = render_status(data, no_color=args.no_color, separator=args.separator)
    except Exception:
        # Failsafe fallback if unexpected errors occur
        output = "[Unknown Model] | Ctx: 0 in / 0 out"

    print(output)

if __name__ == "__main__":
    main()

