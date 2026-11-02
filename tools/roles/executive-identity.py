#!/usr/bin/env python3
"""
executive-identity.py

Executive Identity Persistence & Lifecycle Management CLI for Orca/Agentic Environments.
Handles strict schema validation, atomic binding, concurrency locking, preamble generation,
and event-driven reporting route verification.
"""

import argparse
import fcntl
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCHEMA_VERSION = 2
def _default_config_dir() -> Path:
    # Deployed layouts keep config beside the script (tools/roles/config) or in a sibling dir (products/agentic-env/config).
    here = Path(__file__).resolve().parent
    for candidate in (here / "config", here.parent / "config"):
        if (candidate / "executive-roles.json").exists():
            return candidate
    return Path("products/agentic-env/config")


_CONFIG_DIR = _default_config_dir()
DEFAULT_CONFIG_PATH = _CONFIG_DIR / "executive-roles.json"
DEFAULT_SCHEMA_PATH = _CONFIG_DIR / "executive-roles.schema.json"
DEFAULT_PROFILES_PATH = _CONFIG_DIR / "executive-profiles.json"
DEFAULT_TOOLS_PATH = _CONFIG_DIR / "project-tools.json"
VALID_ROLES = ["CEO", "CTO", "PM", "Architect", "Engineer", "Designer", "Consultant", "QA"]


MULTI_SEAT_ROLES = ("Engineer", "QA")


def seat_slot(role: str, seat: int = 1, workspace_root: Optional[Path] = None) -> str:
    """Registry key for a role seat; seat 1 keeps the legacy role-only key."""
    if seat < 1:
        raise ConfigValidationError("Seat must be >= 1")
    if seat == 1:
        return role
    if role not in MULTI_SEAT_ROLES:
        raise ConfigValidationError(f"Role '{role}' is single-seat; only {', '.join(MULTI_SEAT_ROLES)} may have extra seats")
    path = DEFAULT_TOOLS_PATH if DEFAULT_TOOLS_PATH.is_absolute() else get_workspace_root(workspace_root) / DEFAULT_TOOLS_PATH
    try:
        limit = int((json.loads(path.read_text(encoding="utf-8")).get("seats") or {}).get(role, 1))
    except (OSError, ValueError, TypeError):
        limit = 1
    if seat > limit:
        raise ConfigValidationError(f"{role} seat {seat} exceeds project-tools.json seats.{role}={limit}; the Board must raise it first")
    return f"{role}#{seat}"


class IdentityError(Exception):
    """Base exception for executive identity errors."""
    pass


class ConfigValidationError(IdentityError):
    """Raised when roles config violates schema or business invariants."""
    pass


class RoleConflictError(IdentityError):
    """Raised when a role is already bound to another live terminal/session."""
    pass


class UnauthorizedAssignerError(IdentityError):
    """Raised when an unapproved assigner attempts to bind a role."""
    pass


class MissingEvidenceError(UnauthorizedAssignerError):
    """Raised when assigner evidence (such as human operator provenance) is missing."""
    pass


class MissingReportRouteError(IdentityError):
    """Raised when a background assignment lacks a mandatory reportTo route."""
    pass


class InvalidReportRouteError(IdentityError):
    """Raised when the specified reportTo route does not exist or is unwritable in Orca."""
    pass


class BindingStaleError(IdentityError):
    """Raised when binding runtime or config digest is stale."""
    pass


def compute_canonical_json_digest(data: Dict[str, Any]) -> str:
    """Compute sha256 digest of canonical (sorted, no extra whitespace) JSON."""
    raw = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def validate_config_data(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Strictly validate executive roles config dictionary against schema and invariants."""
    errors = []

    if not isinstance(data, dict):
        return False, ["Root configuration must be a JSON object"]

    # Allowed root keys
    allowed_root_keys = {"$schema", "schemaVersion", "revision", "teamId", "roles", "policy", "correctionRules"}
    unknown_keys = set(data.keys()) - allowed_root_keys
    if unknown_keys:
        errors.append(f"Unknown root keys: {', '.join(sorted(unknown_keys))}")

    if data.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {SCHEMA_VERSION}, got {data.get('schemaVersion')}")

    if not isinstance(data.get("revision"), str) or not data.get("revision", "").strip():
        errors.append("revision must be a non-empty string")

    if not isinstance(data.get("teamId"), str) or not data.get("teamId", "").strip():
        errors.append("teamId must be a non-empty string")

    correction_rules = data.get("correctionRules")
    if correction_rules is not None and not isinstance(correction_rules, dict):
        errors.append("correctionRules must be a dictionary")

    roles = data.get("roles")
    if not isinstance(roles, dict):
        errors.append("roles must be a dictionary")
    else:
        missing_roles = set(VALID_ROLES) - set(roles.keys())
        if missing_roles:
            errors.append(f"Missing required roles: {', '.join(sorted(missing_roles))}")
        extra_roles = set(roles.keys()) - set(VALID_ROLES)
        if extra_roles:
            errors.append(f"Unknown roles defined: {', '.join(sorted(extra_roles))}")

        allowed_role_keys = {"responsibilities", "reportsTo", "assignmentPolicy", "optional", "stageHooks"}
        allowed_assign_keys = {"allowedAssigners"}
        valid_reports_to = {"human"} | set(VALID_ROLES)

        for role_name, role_def in roles.items():
            if not isinstance(role_def, dict):
                errors.append(f"Role {role_name} definition must be an object")
                continue

            unknown_role_fields = set(role_def.keys()) - allowed_role_keys
            if unknown_role_fields:
                errors.append(f"Role {role_name}: unknown fields {sorted(unknown_role_fields)}")

            stage_hooks = role_def.get("stageHooks")
            if stage_hooks is not None:
                if not isinstance(stage_hooks, dict):
                    errors.append(f"Role {role_name}: stageHooks must be a dictionary")
                else:
                    for hook_name, hook_data in stage_hooks.items():
                        if not isinstance(hook_data, dict):
                            errors.append(f"Role {role_name}: stageHooks.{hook_name} must be a dictionary")

            responsibilities = role_def.get("responsibilities")
            if not isinstance(responsibilities, list) or len(responsibilities) == 0:
                errors.append(f"Role {role_name}: responsibilities must be a non-empty list of strings")
            else:
                for idx, item in enumerate(responsibilities):
                    if not isinstance(item, str) or not item.strip():
                        errors.append(f"Role {role_name}: responsibilities[{idx}] must be a non-empty string")

            reports_to = role_def.get("reportsTo")
            if "optional" in role_def and not isinstance(role_def["optional"], bool):
                errors.append(f"Role {role_name}: optional must be a boolean")
            if reports_to not in valid_reports_to | {"assigner"}:
                errors.append(f"Role {role_name}: reportsTo must be one of {sorted(valid_reports_to)}, got {reports_to}")

            # Circular reportsTo check
            curr = role_name
            visited = set()
            while curr and curr != "human" and curr in roles:
                if curr in visited:
                    errors.append(f"Circular reportsTo detected involving {role_name}")
                    break
                visited.add(curr)
                curr_def = roles.get(curr)
                if isinstance(curr_def, dict):
                    curr = curr_def.get("reportsTo")
                else:
                    break

            assignment_policy = role_def.get("assignmentPolicy")
            if not isinstance(assignment_policy, dict):
                errors.append(f"Role {role_name}: assignmentPolicy must be an object")
            else:
                unknown_assign_fields = set(assignment_policy.keys()) - allowed_assign_keys
                if unknown_assign_fields:
                    errors.append(f"Role {role_name}: unknown assignmentPolicy fields {sorted(unknown_assign_fields)}")

                allowed_assigners = assignment_policy.get("allowedAssigners")
                if not isinstance(allowed_assigners, list) or len(allowed_assigners) == 0:
                    errors.append(f"Role {role_name}: allowedAssigners must be a non-empty list")
                else:
                    for a in allowed_assigners:
                        if a not in valid_reports_to:
                            errors.append(f"Role {role_name}: invalid allowedAssigner: {a}")

            # Structural invariants; concrete authority is project policy.
            if reports_to == role_name:
                errors.append(f"Role {role_name}: reportsTo must not be itself")
            if isinstance(assignment_policy, dict) and isinstance(assignment_policy.get("allowedAssigners"), list):
                assigners = assignment_policy["allowedAssigners"]
                if role_name in assigners:
                    errors.append(f"Role {role_name}: cannot appoint itself")
                if len(set(assigners)) != len(assigners):
                    errors.append(f"Role {role_name}: duplicate allowedAssigners")
            if role_name == "CEO":
                if isinstance(assignment_policy, dict) and assignment_policy.get("allowedAssigners") != ["human"]:
                    errors.append("CEO allowedAssigners MUST be exactly ['human'] (the Board always appoints CEO)")
                if reports_to != "human":
                    errors.append("CEO reportsTo must be 'human' (the Board)")

    policy = data.get("policy")
    if not isinstance(policy, dict):
        errors.append("policy must be an object")
    else:
        allowed_policy_keys = {
            "assignmentRequired",
            "titleIsAuthority",
            "restoreTasks",
            "respectExistingApprovalGates",
            "supervisorPollingAllowed",
            "reportingMode",
            "requiredReportEvents",
            "reportRouteRequired",
            "deliveryRequired",
            "ackRequired",
            "awaitingTimeoutMs",
            "escalateOnTimeout",
        }
        unknown_policy_keys = set(policy.keys()) - allowed_policy_keys
        if unknown_policy_keys:
            errors.append(f"Unknown policy keys: {', '.join(sorted(unknown_policy_keys))}")

        for field in allowed_policy_keys:
            if field not in policy:
                errors.append(f"Missing required policy field: {field}")

        if policy.get("assignmentRequired") is not True:
            errors.append("policy.assignmentRequired must be true")
        if policy.get("titleIsAuthority") is not False:
            errors.append("policy.titleIsAuthority must be false")
        if policy.get("restoreTasks") is not False:
            errors.append("policy.restoreTasks must be false (Cannot restore tasks from identity)")
        if policy.get("respectExistingApprovalGates") is not True:
            errors.append("policy.respectExistingApprovalGates must be true")
        if policy.get("supervisorPollingAllowed") is not False:
            errors.append("policy.supervisorPollingAllowed must be false (Strict No Polling)")
        if policy.get("reportingMode") != "event-driven":
            errors.append(f"policy.reportingMode must be 'event-driven', got {policy.get('reportingMode')}")
        req_events = policy.get("requiredReportEvents")
        if not isinstance(req_events, list) or not {"completed", "blocked", "received", "awaiting_timeout"}.issubset(set(req_events)):
            errors.append("policy.requiredReportEvents must be a list containing 'completed', 'blocked', 'received' and 'awaiting_timeout'")
        else:
            for ev in req_events:
                if not isinstance(ev, str):
                    errors.append(f"policy.requiredReportEvents elements must be strings, got {ev}")
        if policy.get("reportRouteRequired") is not True:
            errors.append("policy.reportRouteRequired must be true")
        for flag in ("deliveryRequired", "ackRequired", "escalateOnTimeout"):
            if policy.get(flag) is not True:
                errors.append(f"policy.{flag} must be true (Handoff liveness)")
        timeout_ms = policy.get("awaitingTimeoutMs")
        if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int) or timeout_ms < 60000:
            errors.append("policy.awaitingTimeoutMs must be an integer >= 60000")

    return len(errors) == 0, errors


def resolve_config_path(config_path: Optional[Path] = None, workspace_root: Optional[Path] = None) -> Path:
    """Resolve config path with workspace-aware candidate fallback."""
    ws = get_workspace_root(workspace_root)
    if config_path:
        if config_path.is_absolute():
            return config_path
        candidate = ws / config_path
        if candidate.exists():
            return candidate

    candidates = [
        ws / "products/agentic-env/config/executive-roles.json",
        ws / "tools/roles/config/executive-roles.json",
        ws / "config/roles/executive-roles.json",
        ws / "config/executive-roles.json",
        ws / ".agents/roles/executive-roles.json",
    ]
    for c in candidates:
        if c.exists():
            return c

    if config_path:
        return config_path if config_path.is_absolute() else (ws / config_path)
    return ws / DEFAULT_CONFIG_PATH


def load_and_validate_config(config_path: Path, workspace_root: Optional[Path] = None) -> Tuple[Dict[str, Any], str]:
    """Load config file, validate, and return data + sha256 digest."""
    resolved_path = resolve_config_path(config_path, workspace_root)
    if not resolved_path.exists():
        raise ConfigValidationError(f"Configuration file not found: {resolved_path}")

    try:
        with open(resolved_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        raise ConfigValidationError(f"Failed to parse JSON config: {e}")

    valid, errors = validate_config_data(data)
    if not valid:
        raise ConfigValidationError(f"Config validation failed:\n  - " + "\n  - ".join(errors))

    digest = compute_canonical_json_digest(data)
    return data, digest


def get_workspace_root(workspace_override: Optional[Path] = None) -> Path:
    """Locate workspace root, honoring explicit override."""
    if workspace_override:
        return workspace_override.resolve()
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True
        )
        return Path(res.stdout.strip()).resolve()
    except Exception:
        return Path(os.getcwd()).resolve()


def get_workspace_key(workspace_root: Path) -> str:
    """Generate deterministic workspace key for scratch namespace."""
    realpath_str = str(workspace_root.resolve())
    h = hashlib.sha256(realpath_str.encode("utf-8")).hexdigest()[:16]
    slug = workspace_root.name.replace("/", "_")
    return f"{slug}-{h}"


def get_storage_dirs(workspace_root: Optional[Path] = None) -> Tuple[Path, Path, Path]:
    """Get bindings, locks, and logs directory paths."""
    ws = get_workspace_root(workspace_root)
    ws_key = get_workspace_key(ws)
    base_dir = ws / ".scratch" / "executive-identity" / ws_key
    bindings_dir = base_dir / "bindings"
    locks_dir = base_dir / "locks"
    logs_dir = base_dir / "logs"

    bindings_dir.mkdir(parents=True, exist_ok=True)
    locks_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    return bindings_dir, locks_dir, logs_dir


def load_profiles(config_path: Path, workspace_root: Optional[Path] = None) -> Dict[str, Any]:
    ws = get_workspace_root(workspace_root)
    path = config_path if config_path.is_absolute() else ws / config_path
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ConfigValidationError(f"Cannot read profiles at {path}: {exc}") from exc
    if not isinstance(data, dict) or set(data) - {"$schema", "schemaVersion", "profiles"}:
        raise ConfigValidationError("Profiles must be an object with no unknown fields")
    profiles = data.get("profiles")
    if type(data.get("schemaVersion")) is not int or data["schemaVersion"] != 1 or not isinstance(profiles, dict) or not profiles:
        raise ConfigValidationError("Profiles require schemaVersion 1 and a non-empty profiles object")
    for name, profile in profiles.items():
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
            raise ConfigValidationError(f"Invalid profile ID: {name}")
        if not isinstance(profile, dict) or not {"description", "roles"} <= set(profile) <= {"description", "roles", "seats"}:
            raise ConfigValidationError(f"Profile {name} requires description and roles, and may add seats")
        if not isinstance(profile["description"], str) or not profile["description"].strip():
            raise ConfigValidationError(f"Profile {name} requires a description")
        roles = profile["roles"]
        if not isinstance(roles, dict) or set(roles) != set(VALID_ROLES):
            raise ConfigValidationError(f"Profile {name} must cover exactly {VALID_ROLES}")
        seats = profile.get("seats", {})
        if not isinstance(seats, dict) or any(not re.fullmatch(r"(Engineer|QA)#[2-9]\d?", k) for k in seats):
            raise ConfigValidationError(f"Profile {name} seats must be keyed like Engineer#2")
        for role, execution in list(roles.items()) + list(seats.items()):
            if not isinstance(execution, dict) or set(execution) != {"cli", "model", "effort"}:
                raise ConfigValidationError(f"Profile {name}/{role} requires only cli, model and effort")
            cli, model, effort = execution["cli"], execution["model"], execution["effort"]
            if cli not in ("copilot", "agy", "pi", None) or effort not in (
                "off", "minimal", "low", "medium", "high", "xhigh", "max", None
            ):
                raise ConfigValidationError(f"Unsupported CLI or effort in {name}/{role}")
            if model is not None and (not isinstance(model, str) or not model.strip() or model.startswith("-")):
                raise ConfigValidationError(f"Invalid model ID in {name}/{role}")
            if cli is not None and model is None:
                raise ConfigValidationError(f"Resolved CLI requires a model in {name}/{role}")
    return data


def profile_state_path(workspace_root: Optional[Path] = None) -> Path:
    return get_storage_dirs(workspace_root)[0].parent / "profile.json"


def resolve_profile(
    profiles_path: Path = DEFAULT_PROFILES_PATH,
    workspace_root: Optional[Path] = None,
    profile_id: Optional[str] = None,
    required: bool = True,
) -> Optional[Dict[str, Any]]:
    state_path = profile_state_path(workspace_root)
    if profile_id is None and state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ConfigValidationError(f"Cannot read selected profile: {exc}") from exc
        if not isinstance(state, dict) or not isinstance(state.get("profileId"), str):
            raise ConfigValidationError("Selected profile state requires profileId")
        profile_id = state["profileId"]
    if profile_id is None:
        if required:
            raise ConfigValidationError("No environment profile selected; use profile-select explicitly")
        return None
    profiles = load_profiles(profiles_path, workspace_root)["profiles"]
    if profile_id not in profiles:
        raise ConfigValidationError(f"Unknown profile: {profile_id}")
    profile = profiles[profile_id]
    return {
        "profileId": profile_id,
        "profileDigest": compute_canonical_json_digest(profile),
        **profile,
    }


def select_profile(profile_id: str, profiles_path: Path, workspace_root: Optional[Path] = None) -> Dict[str, Any]:
    profile = resolve_profile(profiles_path, workspace_root, profile_id)
    path = profile_state_path(workspace_root)
    _, locks, logs = get_storage_dirs(workspace_root)
    with RoleLock(locks / "profile.lock"):
        tmp = path.with_suffix(f".tmp.{os.getpid()}")
        tmp.write_text(json.dumps({"profileId": profile["profileId"]}) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        append_audit_log(logs, "profile-select", {"profileId": profile_id, "profileDigest": profile["profileDigest"]})
    return profile


def staffed_roles(profile: Dict[str, Any]) -> List[str]:
    """Roles the profile can launch (CLI and model configured)."""
    return [r for r, e in profile["roles"].items() if e.get("cli") is not None and e.get("model") is not None]


def profile_summary(profile: Dict[str, Any]) -> Dict[str, Any]:
    return {"profileId": profile["profileId"], "description": profile.get("description"),
            "staffedRoles": staffed_roles(profile)}


def configured_execution(profile: Dict[str, Any], role: str) -> Dict[str, Any]:
    execution = profile["roles"][role]
    if execution["cli"] is None or execution["model"] is None:
        raise ConfigValidationError(f"Unresolved CLI/model mapping for {profile['profileId']}/{role}; configure it explicitly")
    return execution


def run_probe_command(argv: List[str], cwd: Path, timeout: int = 30) -> str:
    try:
        result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise IdentityError(f"Probe failed for {argv[0]}: {exc}") from exc
    if result.returncode:
        raise IdentityError(f"Probe exited {result.returncode}: {(result.stderr or result.stdout).strip()}")
    return result.stdout if result.stdout else result.stderr


def preflight_profile(
    profile: Dict[str, Any], role: str, workspace_root: Optional[Path] = None, probe: bool = False,
) -> Dict[str, Any]:
    ws = get_workspace_root(workspace_root)
    execution = configured_execution(profile, role)
    cli, model, effort = execution["cli"], execution["model"], execution["effort"]
    executable = shutil.which(cli)
    if not executable:
        raise IdentityError(f"CLI '{cli}' is not installed or not on PATH")
    version = run_probe_command([executable, "--version"], ws).strip()
    help_text = run_probe_command([executable, "--help"], ws)
    effort_flag = "--reasoning-effort" if cli == "copilot" else ("--thinking" if cli == "pi" else "--effort")
    if "--model" not in help_text or (effort is not None and effort_flag not in help_text):
        raise IdentityError(f"Installed {cli} does not advertise required model/effort flags")
    if cli == "copilot":
        catalog = run_probe_command([executable, "help", "config"], ws)
        advertised = re.search(r"""["']""" + re.escape(model) + r"""["']""", catalog) is not None
    elif cli == "pi":
        catalog = run_probe_command([executable, "--list-models"], ws)
        advertised = any(
            len(parts) >= 2 and parts[1] == model
            for line in catalog.splitlines()
            if (parts := line.split())
        )
    else:
        catalog = run_probe_command([executable, "models"], ws)
        advertised = any(line.split("\t")[0] == model for line in catalog.splitlines())
    if not advertised:
        raise IdentityError(f"Model '{model}' is not advertised by {cli}; no fallback will be used")
    result = {
        "profileId": profile["profileId"], "profileDigest": profile["profileDigest"], "role": role,
        "requested": execution, "executable": executable, "version": version,
        "catalogEvidence": "cli-help-only" if cli == "copilot" else "provider-model-catalog",
        "status": "unverified", "authentication": "unverified", "inference": "unverified",
        "observedModel": None, "observedEffort": None, "ack": "unverified",
        "message": "Configuration is advertised, not runtime-verified. Use --probe for an opt-in inference check.",
    }
    if probe:
        if cli == "copilot":
            argv = [
                executable, "--no-auto-update", "--no-custom-instructions", "--disable-builtin-mcps",
                "--deny-tool=*", "--no-ask-user", "--silent", "--model", model,
            ]
            if effort is not None:
                argv += ["--reasoning-effort", effort]
            argv += ["--prompt", "Do not use tools. Reply with exactly EXECUTIVE_PROFILE_OK and nothing else."]
        elif cli == "pi":
            argv = [
                executable, "-p", "--no-session", "--no-tools", "--model", model,
            ]
            if effort is not None:
                argv += ["--thinking", effort]
            argv.append("Do not use tools. Reply with exactly EXECUTIVE_PROFILE_OK and nothing else.")
        else:
            raise IdentityError(f"Live probe is currently supported only for Copilot and Pi; {cli} remains unverified")
        output = run_probe_command(argv, ws, timeout=120).strip()
        if output != "EXECUTIVE_PROFILE_OK":
            raise IdentityError(f"Inference probe did not return the expected response: {output[:500]}")
        result.update(
            status="inference_verified", authentication="verified-by-inference", inference="passed",
            message="Pinned inference request succeeded; actual model/effort and cross-terminal ACK are not independently observed.",
        )
    return result


def effective_reports_to(role_spec, assigned_by):
    """`assigner` means the role reports to whoever appointed it."""
    reports_to = role_spec["reportsTo"]
    return (assigned_by or "human") if reports_to == "assigner" else reports_to


def validate_assignment(
    config_data: Dict[str, Any], role: str, assigned_by: str, assigner_evidence: Optional[str],
    report_to: Optional[str], allow_offline: bool = False,
) -> None:
    if role not in config_data["roles"]:
        raise ConfigValidationError(f"Role '{role}' is not defined in configuration")
    role_spec = config_data["roles"][role]
    allowed_assigners = role_spec["assignmentPolicy"]["allowedAssigners"]
    if assigned_by not in allowed_assigners:
        raise UnauthorizedAssignerError(
            f"Assigner '{assigned_by}' is not authorized to assign role '{role}'. Allowed assigners: {allowed_assigners}"
        )
    if assigned_by == "human" and not (assigner_evidence or "").strip():
        assigner_evidence = "cli-operator"
    if report_to == "human":
        # The Board is reached in the appointing conversation, not through an Orca terminal.
        if effective_reports_to(role_spec, assigned_by) != "human":
            raise MissingReportRouteError(
                f"Role '{role}' reports to {effective_reports_to(role_spec, assigned_by)}; 'human' is not a valid route"
            )
        report_to = None
    if config_data["policy"]["reportRouteRequired"] and effective_reports_to(role_spec, assigned_by) != "human" and not report_to:
        raise MissingReportRouteError(f"Role '{role}' requires an explicit reportTo route to {effective_reports_to(role_spec, assigned_by)}")
    if report_to:
        route_ok, route_msg = verify_dispatch_route(report_to, allow_offline=allow_offline)
        if not route_ok:
            raise InvalidReportRouteError(f"Invalid reportTo route '{report_to}': {route_msg}")


SKILL_DIRS = (".agents/skills", ".github/skills", ".claude/skills", ".copilot/skills", ".codex/skills",
              ".gemini/skills", ".gemini/antigravity/skills", ".cursor/skills", ".opencode/skills")


def onboarding_context(ws: Path) -> Dict[str, Any]:
    agents = ws / "AGENTS.md"
    if not agents.is_file():
        raise ConfigValidationError("AGENTS.md is missing; onboarding requires the project rules file")
    dirs = []
    for rel in SKILL_DIRS:
        d = ws / rel
        if d.is_dir():
            names = sorted(x.name for x in d.iterdir() if (x / "SKILL.md").is_file())
            if names:
                dirs.append({"path": rel, "count": len(names)})
    return {"agentsMd": "AGENTS.md", "agentsSha256": hashlib.sha256(agents.read_bytes()).hexdigest()[:12],
            "skillDirs": dirs}


def onboarding_instructions(ctx: Dict[str, Any]) -> str:
    skills = ", ".join(f"{d['path']} ({d['count']})" for d in ctx["skillDirs"]) or "none found"
    return (
        f"Onboarding step 1 (mandatory, before any other action): follow {ctx['agentsMd']}; if your CLI did not already "
        "inject it as custom instructions, read it in full. Do not re-read an injected copy. "
        f"Your received ACK must include agentsSha256={ctx['agentsSha256']} (first 12 hex of `shasum -a 256 {ctx['agentsMd']}`); "
        "if your computed value differs, read the file and report the new value. Load only team-rules and your role "
        "entry now; load orca-cli, orchestration and skill references only when first needed, section by section. "
        f"Step 2: project skills are available in: {skills}. Your role contract limits authority, not tools: "
        "discover and use these skills during development whenever one matches the task, following AGENTS.md "
        "skill discovery and tracking rules. If you work in a git worktree whose skill links are missing, run the "
        "project's link-worktree-skills script before starting; if skills remain unreachable, report blocked."
    )


def prepare_launch(
    profile: Dict[str, Any], role: str, assigned_by: str, assigner_evidence: Optional[str],
    report_to: Optional[str], assignment_id: str, task: str,
    config_path: Path = DEFAULT_CONFIG_PATH, workspace_root: Optional[Path] = None,
    profiles_path: Path = DEFAULT_PROFILES_PATH,
    seat: int = 1, terminal_worktree: Optional[Path] = None, override: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    ws = get_workspace_root(workspace_root)
    config, digest = load_and_validate_config(config_path, ws)
    validate_assignment(config, role, assigned_by, assigner_evidence, report_to)
    selected = resolve_profile(profiles_path, ws)
    if (selected["profileId"], selected["profileDigest"]) != (profile["profileId"], profile["profileDigest"]):
        raise ConfigValidationError("Launch profile differs from selected environment; use profile-select explicitly")
    if not assignment_id.strip() or not task.strip():
        raise ConfigValidationError("Launch preparation requires a non-empty assignment ID and task")
    base = configured_execution(profile, role)
    seat_cfg = (profile.get("seats") or {}).get(f"{role}#{seat}") if seat > 1 else None
    execution, source = dict(seat_cfg or base), "seat" if seat_cfg else "role"
    given = {k: v for k, v in (override or {}).items() if v}
    if given:
        execution.update(given)
        source = "override"
        if execution["cli"] not in ("copilot", "agy", "pi") or not execution["model"] or str(execution["model"]).startswith("-") \
                or execution["effort"] not in ("off", "minimal", "low", "medium", "high", "xhigh", "max", None):
            raise ConfigValidationError("Invalid --cli/--model/--effort override")
    cli = execution["cli"]
    if cli not in ("copilot", "agy", "pi"):
        raise IdentityError(f"Unsupported launch CLI '{cli}'; supported: copilot, agy, pi")
    effective = {**profile, "roles": {**profile["roles"], role: execution}}
    preflight = preflight_profile(effective, role, ws)
    requested = {**execution, "source": source, "differsFromProfile": execution != base}
    if not shutil.which("orca"):
        raise IdentityError("Orca is unavailable; role contracts remain usable manually, but cross-terminal launch is unavailable")
    role_spec = config["roles"][role]
    onboarding = onboarding_context(ws)
    prompt = (
        f"Authorized role assignment: {role}; assignedBy={assigned_by}; assignmentId={assignment_id}.\n"
        f"Reports to {effective_reports_to(role_spec, assigned_by)}; reportTo={report_to or 'human'}.\n"
        f"Requested profile={profile['profileId']}; profileDigest={profile['profileDigest']}; roleDigest={digest}.\n"
        f"Requested execution: {json.dumps(requested)}. Do not claim actual model verification without evidence.\n"
        f"Role contract: {json.dumps(role_spec, ensure_ascii=False)}\n"
        f"Shared policy: {json.dumps(config['policy'], ensure_ascii=False)}\n"
        f"{onboarding_instructions(onboarding)}\n"
        "Then read the executive identity runbook. Establish your own role binding using the selected "
        "profile and the supplied assignment ID, assigner and report route; do not infer them from a title. "
        "If the selected profile/digest differs from this request, report blocked instead of binding. "
        + (f"Your seat is {seat}: bind with --seat {seat} --workspace-root {ws} so the binding lands in the main workspace, "
           f"and pass --project {ws} on work commands. " if seat > 1 or terminal_worktree else "")
        + "Send received/completed/blocked events with assignmentId and a unique eventId via the verified report "
        "route. Do not poll, restore old tasks, or fabricate an Orca Dispatch. "
        "This is an ordinary role assignment, not a supervised lifecycle preamble.\n"
        f"Role config path: {resolve_config_path(config_path, ws)}\n"
        f"Profiles config path: {profiles_path if profiles_path.is_absolute() else ws / profiles_path}\n"
        f"Assigner evidence: {assigner_evidence or 'authorized agent assignment'}\nTask: {task}"
    )
    # Plain terminal execution with pinned initial CLI/model/effort
    prompt_file = ws / ".scratch" / "executive-identity" / "launch-prompts" / f"{assignment_id}-{role}.md"
    prompt_file.parent.mkdir(parents=True, exist_ok=True)
    prompt_file.write_text(prompt, encoding="utf-8")
    if cli == "copilot":
        command = f"copilot --yolo --model {shlex.quote(execution['model'])}"
        if execution["effort"] is not None:
            command += f" --reasoning-effort {shlex.quote(execution['effort'])}"
        command += f' -i "$(cat {shlex.quote(str(prompt_file))})"'
    elif cli == "agy":
        command = f"agy --dangerously-skip-permissions --model {shlex.quote(execution['model'])}"
        if execution["effort"] is not None:
            command += f" --effort {shlex.quote(execution['effort'])}"
        command += f' -i "$(cat {shlex.quote(str(prompt_file))})"'
    elif cli == "pi":
        command = f"pi --model {shlex.quote(execution['model'])}"
        if execution["effort"] is not None:
            command += f" --thinking {shlex.quote(execution['effort'])}"
        command += f' "$(cat {shlex.quote(str(prompt_file))})"'
    argv = [
        "orca", "terminal", "create", "--worktree", f"path:{terminal_worktree or ws}", "--title", role if seat == 1 else f"{role}#{seat}",
        "--command", command, "--json",
    ]
    return {
        "status": "prepared_not_launched", "requested": requested, "argv": argv, "promptFile": str(prompt_file), "preflight": preflight,
        "onboarding": onboarding, "profile": profile_summary(profile),
        "message": "No agent launched or binding created. Require launch receipt, recipient ACK and runtime evidence before reporting readiness.",
    }


def dispatch_check(ticket: str, plan: str, tools_path: Path, workspace_root: Optional[Path] = None, trivial: str = "") -> Dict[str, Any]:
    """Engineer self-check before acknowledging a dispatch: ticket and approved plan must both exist."""
    ws = get_workspace_root(workspace_root)
    path = tools_path if tools_path.is_absolute() else ws / tools_path
    try:
        tools = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ConfigValidationError(f"Cannot read project tools at {path}: {exc}") from exc
    workflow = tools.get("workflow", {})
    ticketing = tools.get("ticketing", {})
    plans_dir = (tools.get("plans") or {}).get("dir", "docs/plans")
    problems: List[str] = []
    result: Dict[str, Any] = {"ticket": ticket or None, "plan": plan or None,
                              "required": bool(workflow.get("requireTicketAndPlanForDispatch", True))}
    if not ticket:
        problems.append("missing ticket id")
    if trivial.strip():
        result["trivial"] = trivial.strip()
    elif not plan:
        problems.append("missing plan path (CTO plan required; use --trivial <reason> only for trivial changes)")
    else:
        plan_path = (ws / plan).resolve()
        if not plan_path.is_file():
            problems.append(f"plan not found: {plan}")
        elif not plan_path.is_relative_to((ws / plans_dir).resolve()):
            problems.append(f"plan must be under {plans_dir}")
        elif ticket and ticket.lstrip("#") not in plan_path.read_text(encoding="utf-8"):
            problems.append(f"plan does not reference ticket {ticket} (CTO plan must name the ticket)")
    if ticket:
        if ticketing.get("skill"):
            result["ticketVerification"] = "unverified"
            result["ticketSkill"] = ticketing["skill"]
        else:
            ticket_file = ws / ticketing.get("fileDir", "docs/tickets") / f"{ticket}.md"
            result["ticketVerification"] = "file"
            if not ticket_file.is_file():
                problems.append(f"ticket not found: {ticket_file.relative_to(ws)}")
    result["problems"] = problems
    result["ok"] = not problems or not result["required"]
    return result


def detect_environment_caller() -> Dict[str, Any]:
    """
    Probe environment variables for authoritative Orca session/terminal metadata.
    Never guesses from active UI tab or title. Tab ID is NOT treated as session.
    """
    terminal_handle = os.environ.get("ORCA_TERMINAL_HANDLE")
    runtime_source_id = os.environ.get("ORCA_RUNTIME_SOURCE_ID")
    runtime_incarnation = os.environ.get("ORCA_RUNTIME_SOURCE_INCARNATION")
    # Only true session launch token/hook token is session ID, not tab ID
    orca_session_id = os.environ.get("ORCA_AGENT_LAUNCH") or os.environ.get("ORCA_AGENT_HOOK_TOKEN")
    worktree_id = os.environ.get("ORCA_WORKTREE_ID")
    pane_key = os.environ.get("ORCA_PANE_KEY")

    is_manual = terminal_handle is None

    return {
        "terminalHandle": terminal_handle,
        "runtimeId": runtime_incarnation or runtime_source_id,
        "orcaSessionId": orca_session_id,
        "worktreeId": worktree_id,
        "paneKey": pane_key,
        "executionHostId": "local",
        "isManualMode": is_manual,
    }


def list_orca_terminals() -> List[Dict[str, Any]]:
    """Query `orca terminal list --json` if available."""
    try:
        res = subprocess.run(
            ["orca", "terminal", "list", "--json"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if res.returncode == 0:
            data = json.loads(res.stdout)
            return data.get("result", {}).get("terminals", [])
    except Exception:
        pass
    return []


def is_terminal_alive(handle: Optional[str]) -> Optional[bool]:
    """
    Check if an Orca terminal handle is currently alive and connected.
    Returns:
      True: terminal exists and is connected
      False: terminal exists and is disconnected, or terminal list verified and handle absent
      None: cannot determine (Orca unavailable / unknown)
    """
    if not handle:
        return False
    terminals = list_orca_terminals()
    if not terminals:
        return None
    for t in terminals:
        if t.get("handle") == handle:
            return t.get("connected", False) is True
    return False


def verify_dispatch_route(target_handle: str, allow_offline: bool = False) -> Tuple[bool, str]:
    """Verify that a target terminal handle exists and is writable in Orca."""
    if target_handle.lower() in ("human", "board"):
        return True, "Board route: reply in the appointing conversation; no Orca terminal is involved"
    terminals = list_orca_terminals()
    if not terminals:
        if allow_offline:
            return True, f"Offline mode: route '{target_handle}' assumed valid without Orca daemon"
        return False, "Cannot query Orca terminals (orca CLI unavailable or daemon stopped)"

    for t in terminals:
        if t.get("handle") == target_handle:
            if not t.get("connected", False):
                return False, f"Target terminal '{target_handle}' exists but is disconnected"
            if not t.get("writable", False):
                return False, f"Target terminal '{target_handle}' is not writable"
            return True, f"Target terminal '{target_handle}' is active and writable"

    return False, f"Target terminal '{target_handle}' not found in active Orca terminals"


class RoleLock:
    """File-based advisory lock context manager with timeout."""
    def __init__(self, lock_path: Path, timeout: float = 3.0):
        self.lock_path = lock_path
        self.timeout = timeout
        self.file_handle = None

    def __enter__(self):
        self.file_handle = open(self.lock_path, "w+")
        start_time = time.time()
        while True:
            try:
                fcntl.flock(self.file_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except (BlockingIOError, IOError):
                if time.time() - start_time > self.timeout:
                    raise RoleConflictError(f"Timed out acquiring lock for {self.lock_path.name}")
                time.sleep(0.05)

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.file_handle:
            try:
                fcntl.flock(self.file_handle.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass
            self.file_handle.close()


def append_audit_log(logs_dir: Path, action: str, details: Dict[str, Any]):
    """Record an audit trail entry."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "details": details,
    }
    log_file = logs_dir / "audit.jsonl"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def bootstrap_role(
    role: str,
    assigned_by: str,
    assignment_id: Optional[str] = None,
    assigner_evidence: Optional[str] = None,
    report_to: Optional[str] = None,
    terminal_handle: Optional[str] = None,
    runtime_id: Optional[str] = None,
    orca_session_id: Optional[str] = None,
    config_path: Path = DEFAULT_CONFIG_PATH,
    workspace_root: Optional[Path] = None,
    allow_offline: bool = False,
    force: bool = False,
    profiles_path: Path = DEFAULT_PROFILES_PATH,
    seat: int = 1,
) -> Dict[str, Any]:
    """
    Bind a role to current execution context with strict validation, evidence checks,
    locking, route verification, and fail-closed posture.
    """
    ws = get_workspace_root(workspace_root)
    config_data, config_digest = load_and_validate_config(config_path, ws)
    team_config = resolve_config_path(config_path, ws).parent / "team-config.json"
    if team_config.exists():
        team = json.loads(team_config.read_text(encoding="utf-8"))
        if team.get("enabled") is not True:
            raise UnauthorizedAssignerError("Team is disabled; new role bindings are not authorized")

    operation_pointer = ws / ".scratch/agentic-team/current-operation.json"
    if operation_pointer.exists():
        pointer = json.loads(operation_pointer.read_text(encoding="utf-8"))
        receipt_path = (ws / pointer["receipt"]).resolve()
        if not receipt_path.is_relative_to(ws):
            raise UnauthorizedAssignerError("Invalid deployment receipt path")
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("status") not in ("completed", "recovered"):
            raise UnauthorizedAssignerError("Team deployment is partially applied; recover before binding")

    if assigned_by == "human" and not (assigner_evidence or "").strip():
        assigner_evidence = "cli-operator"
    supervisor = effective_reports_to(config_data["roles"][role], assigned_by)
    if not report_to and supervisor != "human":
        # Default the report route to the supervisor role's currently bound terminal.
        supervisor_file = get_storage_dirs(ws)[0] / f"{supervisor}.json"
        if supervisor_file.exists():
            report_to = json.loads(supervisor_file.read_text(encoding="utf-8")).get("terminalHandle")
    validate_assignment(config_data, role, assigned_by, assigner_evidence, report_to, allow_offline)
    role_spec = config_data["roles"][role]
    reports_to = effective_reports_to(role_spec, assigned_by)
    profile = resolve_profile(profiles_path, ws, required=False)
    execution = configured_execution(profile, role) if profile else None

    # Probe caller environment
    env_info = detect_environment_caller()
    effective_handle = terminal_handle or env_info["terminalHandle"]
    effective_runtime = runtime_id or env_info["runtimeId"]
    effective_session = orca_session_id or env_info["orcaSessionId"]

    # Strict caller & incarnation validation
    actual_incarnation = None
    terminal_verified = False
    is_manual_mode = True

    if effective_handle:
        terminals = list_orca_terminals()
        if terminals:
            matching = [t for t in terminals if t.get("handle") == effective_handle]
            if not matching:
                if allow_offline:
                    terminal_verified = True
                    is_manual_mode = False
                    actual_incarnation = effective_runtime
                else:
                    raise BindingStaleError(
                        f"Terminal handle '{effective_handle}' is not recognized in active Orca runtime."
                    )
            else:
                term_entry = matching[0]
                if not term_entry.get("connected", False) and not allow_offline:
                    raise BindingStaleError(f"Terminal handle '{effective_handle}' is disconnected in Orca.")
                actual_incarnation = term_entry.get("incarnationId")
                term_ws = term_entry.get("worktreePath")
                if term_ws and Path(term_ws).resolve() != ws.resolve():
                    raise BindingStaleError(
                        f"Terminal workspace mismatch: terminal is in '{term_ws}', "
                        f"but target workspace is '{ws.resolve()}'"
                    )
                terminal_verified = True
                is_manual_mode = False
        elif allow_offline:
            terminal_verified = True
            is_manual_mode = False
            actual_incarnation = effective_runtime

    # If terminal cannot be authoritatively verified against Orca, fail closed to manual_pending
    binding_status = "bound" if (terminal_verified and effective_handle) else "manual_pending"

    bindings_dir, locks_dir, logs_dir = get_storage_dirs(ws)
    slot = seat_slot(role, seat, ws)
    lock_file = locks_dir / f"{slot}.lock"
    binding_file = bindings_dir / f"{slot}.json"

    with RoleLock(lock_file):
        # Concurrency & existing binding check
        if binding_file.exists():
            try:
                with open(binding_file, "r", encoding="utf-8") as f:
                    existing = json.load(f)

                # Strict idempotency check: MUST verify configDigest, reportTo, runtime, assignedBy
                same_handle = effective_handle and existing.get("terminalHandle") == effective_handle
                same_assignment = assignment_id and existing.get("assignmentId") == assignment_id
                same_digest = existing.get("configDigest") == config_digest
                same_route = existing.get("reportTo") == report_to
                same_assigner = existing.get("assignedBy") == assigned_by
                same_status = existing.get("status") == binding_status
                same_profile = (
                    existing.get("profileId") == (profile["profileId"] if profile else None)
                    and existing.get("profileDigest") == (profile["profileDigest"] if profile else None)
                )

                if same_handle and same_assignment and same_digest and same_route and same_assigner and same_status and same_profile:
                    # Idempotent rebind
                    return existing

                # Role conflict check on live terminals
                existing_handle = existing.get("terminalHandle")
                if existing_handle and existing_handle != effective_handle:
                    alive_status = is_terminal_alive(existing_handle)
                    if alive_status is True:
                        # Live role cannot be stolen even with force!
                        raise RoleConflictError(
                            f"Role '{role}' is currently actively bound to live terminal '{existing_handle}'. "
                            f"Live role stealing is strictly forbidden. Revoke from '{existing_handle}' first."
                        )
                    elif alive_status is None and not allow_offline:
                        # Runtime check failed: unknown state, fail closed
                        raise RoleConflictError(
                            f"Cannot verify status of terminal '{existing_handle}'. Runtime query failed. "
                            f"Preserving existing conflict/unknown state. Refusing overwrite."
                        )
                    # If alive_status is False (dead/disconnected), allow rebind under lock
            except (json.JSONDecodeError, IOError):
                pass

        # Construct new binding
        now_iso = datetime.now(timezone.utc).isoformat()
        binding_data = {
            "bindingVersion": 1,
            "teamId": config_data["teamId"],
            "workspaceRealpath": str(ws.resolve()),
            "executionHostId": env_info["executionHostId"],
            "runtimeId": effective_runtime,
            "terminalHandle": effective_handle,
            "incarnationId": actual_incarnation or effective_runtime,
            "orcaSessionId": effective_session,
            "assignmentId": assignment_id or f"assign-{int(time.time())}",
            "role": role,
            "seat": seat,
            "configDigest": config_digest,
            "configRevision": config_data["revision"],
            "assignedBy": assigned_by,
            "assignerEvidence": assigner_evidence,
            "assignedAt": now_iso,
            "reportTo": report_to,
            "reportsToRole": reports_to,
            "isManualMode": is_manual_mode,
            "sessionVerified": bool(effective_session),
            "status": binding_status,
            "profileId": profile["profileId"] if profile else None,
            "profileDigest": profile["profileDigest"] if profile else None,
            "requestedExecution": execution,
            "executionVerification": "unverified" if profile else "profile_unselected",
        }

        # Atomic write
        tmp_file = bindings_dir / f"{slot}.json.tmp.{os.getpid()}"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(binding_data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_file, binding_file)

        append_audit_log(logs_dir, "bootstrap", {
            "role": role,
            "seat": seat,
            "assignedBy": assigned_by,
            "terminalHandle": effective_handle,
            "assignmentId": binding_data["assignmentId"],
            "status": binding_status,
        })

    return binding_data


def get_role_status(
    role: str,
    config_path: Path = DEFAULT_CONFIG_PATH,
    workspace_root: Optional[Path] = None,
    caller_handle: Optional[str] = None,
    allow_offline: bool = False,
    profiles_path: Path = DEFAULT_PROFILES_PATH,
    seat: int = 1,
) -> Dict[str, Any]:
    """
    Retrieve verified role binding status with fail-closed unknown handling and caller matching.
    """
    ws = get_workspace_root(workspace_root)
    bindings_dir, _, _ = get_storage_dirs(ws)
    binding_file = bindings_dir / f"{seat_slot(role, seat, ws)}.json"

    if not binding_file.exists():
        return {
            "role": role,
            "status": "unassigned",
            "message": f"Role '{role}' has no active binding in this workspace."
        }

    try:
        with open(binding_file, "r", encoding="utf-8") as f:
            binding = json.load(f)
    except Exception as e:
        return {
            "role": role,
            "status": "invalid",
            "message": f"Binding file is corrupted: {e}"
        }

    # Workspace check
    if binding.get("workspaceRealpath") != str(ws.resolve()):
        return {
            "role": role,
            "status": "invalid",
            "message": f"Workspace mismatch. Expected {ws.resolve()}, got {binding.get('workspaceRealpath')}"
        }

    # Config digest check
    try:
        _, current_digest = load_and_validate_config(config_path, ws)
        if binding.get("configDigest") != current_digest:
            return {
                "role": role,
                "status": "stale_config",
                "message": "Configuration digest mismatch. Config has changed since bootstrap.",
                "binding": binding,
            }
    except Exception as e:
        return {
            "role": role,
            "status": "invalid",
            "message": f"Config validation error: {e}",
            "binding": binding,
        }

    try:
        profile = resolve_profile(profiles_path, ws, required=False)
    except ConfigValidationError as exc:
        return {"role": role, "status": "invalid", "message": str(exc), "binding": binding}
    profile_id = profile["profileId"] if profile else None
    profile_digest = profile["profileDigest"] if profile else None
    profile_drift = (binding.get("profileId") != profile_id or binding.get("profileDigest") != profile_digest)

    # If binding was manual_pending
    if binding.get("status") == "manual_pending":
        res = {
            "role": role,
            "status": "manual_pending",
            "message": "Binding lacks authoritative live terminal evidence. Manual confirmation required.",
            "binding": binding,
        }
        if profile_drift:
            res["profileDrift"] = True
            res["profileMessage"] = "Profile baseline updated or customized; runtime model is hot-swappable."
        return res

    # Terminal check in Orca
    handle = binding.get("terminalHandle")
    if handle and not binding.get("isManualMode"):
        terms = list_orca_terminals()
        if not terms:
            if not allow_offline:
                # Orca unavailable / empty list -> FAIL CLOSED!
                return {
                    "role": role,
                    "status": "unknown",
                    "message": "Cannot reach Orca runtime or terminal list is empty. Fail closed.",
                    "binding": binding,
                }
        else:
            matching = [t for t in terms if t.get("handle") == handle]
            if not matching:
                if not allow_offline:
                    return {
                        "role": role,
                        "status": "stale_runtime",
                        "message": f"Terminal handle '{handle}' no longer exists in Orca runtime.",
                        "binding": binding,
                    }
            elif not matching[0].get("connected", False):
                if not allow_offline:
                    return {
                        "role": role,
                        "status": "stale_runtime",
                        "message": f"Terminal handle '{handle}' is disconnected or closed in Orca runtime.",
                        "binding": binding,
                    }

    # Caller matching check: only enforce when explicitly provided or when running in the same workspace
    effective_caller = caller_handle
    if effective_caller is None:
        caller_env = detect_environment_caller()
        caller_ws = caller_env.get("worktreeId") or ""
        if caller_env.get("terminalHandle") and str(ws.resolve()) in caller_ws:
            effective_caller = caller_env["terminalHandle"]

    if effective_caller and handle and effective_caller != handle:
        res = {
            "role": role,
            "status": "bound_to_other",
            "message": f"Role '{role}' is bound to terminal '{handle}', not caller terminal '{effective_caller}'.",
            "binding": binding,
            "isCaller": False,
        }
        if profile_drift:
            res["profileDrift"] = True
            res["profileMessage"] = "Profile baseline updated or customized; runtime model is hot-swappable."
        return res

    res = {
        "role": role,
        "status": "bound",
        "binding": binding,
        "isCaller": True,
    }
    if profile_drift:
        res["profileDrift"] = True
        res["profileMessage"] = (
            "Selected environment profile baseline updated or customized. "
            "Role identity remains bound; runtime model is hot-swappable."
        )
    return res


def revoke_role(
    role: str,
    workspace_root: Optional[Path] = None,
    seat: int = 1,
) -> bool:
    """Revoke an active role binding safely."""
    ws = get_workspace_root(workspace_root)
    bindings_dir, locks_dir, logs_dir = get_storage_dirs(ws)
    slot = seat_slot(role, seat, ws)
    lock_file = locks_dir / f"{slot}.lock"
    binding_file = bindings_dir / f"{slot}.json"

    with RoleLock(lock_file):
        if binding_file.exists():
            binding_file.unlink()
            append_audit_log(logs_dir, "revoke", {"role": role, "seat": seat})
            return True
        return False


def generate_preamble(
    role: str,
    config_path: Path = DEFAULT_CONFIG_PATH,
    workspace_root: Optional[Path] = None,
    caller_handle: Optional[str] = None,
    allow_offline: bool = False,
    profiles_path: Path = DEFAULT_PROFILES_PATH,
    seat: int = 1,
) -> str:
    """
    Generate concise role preamble for agent context injection.
    Strictly REFUSES generation if status is not 'bound'.
    """
    ws = get_workspace_root(workspace_root)
    config_data, digest = load_and_validate_config(config_path, ws)

    if role not in config_data["roles"]:
        raise ConfigValidationError(f"Role '{role}' is not in config")

    status_info = get_role_status(role, config_path, ws, caller_handle, allow_offline=allow_offline, profiles_path=profiles_path, seat=seat)
    current_status = status_info.get("status")

    if current_status != "bound":
        raise IdentityError(
            f"Cannot generate preamble: Role '{role}' has status '{current_status}' "
            f"({status_info.get('message', 'No active binding')}). "
            f"Preamble generation is strictly rejected for unassigned, stale, or invalid roles."
        )

    role_spec = config_data["roles"][role]
    binding = status_info.get("binding", {})

    assigned_by = binding.get("assignedBy", "human")
    assignment_id = binding.get("assignmentId", "unassigned")
    report_to = binding.get("reportTo", "human (N/A)")
    handle = binding.get("terminalHandle", "unbound")

    bullet_resps = "\n".join(f"  - {r}" for r in role_spec["responsibilities"])

    stage_hooks = role_spec.get("stageHooks", {})
    hooks_text = ""
    if stage_hooks and isinstance(stage_hooks, dict):
        hook_lines = []
        for hook_name, hook_info in stage_hooks.items():
            if not isinstance(hook_info, dict):
                continue
            req_skill = hook_info.get("requiredSkill", "")
            cmd = hook_info.get("command", "")
            desc = hook_info.get("description", "")
            out = hook_info.get("outputArtifact", "")
            req_actions = hook_info.get("requiredActions", [])
            details = []
            if req_skill:
                details.append(f"Skill: `{req_skill}`")
            if cmd:
                details.append(f"Command: `{cmd}`")
            if req_actions:
                details.append(f"Actions: {', '.join(req_actions)}")
            if out:
                details.append(f"Evidence: `{out}`")
            if desc:
                details.append(f"Note: {desc}")
            hook_lines.append(f"  - **{hook_name}**: {'; '.join(details)}")
        if hook_lines:
            hooks_text = "- **Mandatory Stage Hooks (Quality Gates)**:\n" + "\n".join(hook_lines) + "\n"

    try:
        script_rel = str(Path(__file__).resolve().relative_to(ws.resolve()))
    except Exception:
        script_rel = "products/agentic-env/scripts/executive-identity.py"

    seat_label = role if seat == 1 else f"{role}#{seat}"
    preamble = f"""### Executive Role Binding: {seat_label}
- **Team**: {config_data['teamId']} (Revision: {config_data['revision']}, Digest: {digest[:12]})
- **Role**: {role}
- **Assigned By**: {assigned_by} (Assignment ID: {assignment_id})
- **Active Terminal**: {handle}
- **Environment**: {binding.get('profileId') or 'unselected'}; requested baseline {json.dumps(binding.get('requestedExecution'))}; runtime model is hot-swappable (role duties remain invariant).
- **Reports To**: {binding.get('reportsToRole') or role_spec['reportsTo']} (Report Route: {report_to})
- **Core Responsibilities**:
{bullet_resps}
{hooks_text}- **Supervisor Polling**: STRICTLY FORBIDDEN. Never poll subordinates or supervisors.
- **Reporting Obligations**: Event-driven only. Must proactively dispatch `[completed]` or `[blocked]` notifications to supervisor handle with `assignmentId` and unique `eventId`.
- **Delivery Obligation**: Output in your own terminal is NOT delivery. Every review result, approval, rejection or blocker must be sent via `orca terminal send` or `orca orchestration send/reply` with `assignmentId` and unique `eventId`.
- **Ack & Bounded Wait**: On receiving a request that needs a reply, send `[received]` with its `eventId` first. After sending such a request, wait with `orca orchestration check --wait --timeout-ms {config_data['policy']['awaitingTimeoutMs']}` (bounded blocking, not a polling loop). On timeout send `[awaiting_timeout]` to your reportTo; never wait idle indefinitely and never use `terminal read` of another terminal as proof of approval.
- **Status & Recovery**: Verify or rebind via `python3 {script_rel} status --role {role}{'' if seat == 1 else f' --seat {seat}'}`.
"""
    return preamble.strip()


def main():
    parser = argparse.ArgumentParser(description="Executive Identity Persistence & Management CLI")
    parser.add_argument("--workspace-root", type=Path, help="Override workspace root directory")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # validate-config
    val_p = subparsers.add_parser("validate-config", help="Validate roles config against schema and invariants")
    val_p.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Path to executive-roles.json")

    # bootstrap
    boot_p = subparsers.add_parser("bootstrap", help="Bind a role to current execution context")
    boot_p.add_argument("--role", required=True, choices=VALID_ROLES, help="Role to bind")
    boot_p.add_argument("--assigned-by", default="human", help="Assigner identity (default: human)")
    boot_p.add_argument("--assigner-evidence", help="Provenance or operator manifest for assignment")
    boot_p.add_argument("--assignment-id", help="Optional assignment ID")
    boot_p.add_argument("--report-to", help="Mandatory reportTo routing handle for subordinate roles")
    boot_p.add_argument("--terminal-handle", help="Override terminal handle")
    boot_p.add_argument("--runtime-id", help="Override runtime ID")
    boot_p.add_argument("--session-id", help="Override session ID")
    boot_p.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    boot_p.add_argument("--allow-offline", action="store_true", help="Allow binding without live Orca daemon")
    boot_p.add_argument("--force", action="store_true", help="Force overwrite stale binding")

    # rebind
    rebind_p = subparsers.add_parser("rebind", help="Explicitly rebind role after context clear")
    rebind_p.add_argument("--role", required=True, choices=VALID_ROLES)
    rebind_p.add_argument("--assigned-by", default="human", help="Assigner identity (default: human)")
    rebind_p.add_argument("--assigner-evidence", help="Provenance or operator manifest for assignment")
    rebind_p.add_argument("--assignment-id")
    rebind_p.add_argument("--report-to")
    rebind_p.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    rebind_p.add_argument("--allow-offline", action="store_true")

    # status
    stat_p = subparsers.add_parser("status", help="Check binding status for a role")
    stat_p.add_argument("--role", required=True, choices=VALID_ROLES)
    stat_p.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    stat_p.add_argument("--caller-handle", help="Check caller terminal handle match")
    stat_p.add_argument("--allow-offline", action="store_true", help="Allow status check without live Orca daemon")
    stat_p.add_argument("--json", action="store_true", help="Output JSON")

    # preamble
    pre_p = subparsers.add_parser("preamble", help="Generate concise role preamble")
    pre_p.add_argument("--role", required=True, choices=VALID_ROLES)
    pre_p.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    pre_p.add_argument("--caller-handle", help="Caller handle to match")
    pre_p.add_argument("--allow-offline", action="store_true", help="Allow preamble generation in offline mode")

    # revoke
    rev_p = subparsers.add_parser("revoke", help="Revoke active role binding")
    rev_p.add_argument("--role", required=True, choices=VALID_ROLES)

    # verify-route
    route_p = subparsers.add_parser("verify-route", help="Verify reportTo routing handle")
    route_p.add_argument("--handle", required=True, help="Terminal handle to check")
    route_p.add_argument("--allow-offline", action="store_true")

    profiles_val_p = subparsers.add_parser("validate-profiles", help="Validate environment profiles without selecting one")
    select_p = subparsers.add_parser("profile-select", help="Explicitly select the workspace environment profile")
    select_p.add_argument("--profile", required=True)
    show_p = subparsers.add_parser("profile-show", help="Show the selected or explicitly named profile")
    show_p.add_argument("--profile")
    flight_p = subparsers.add_parser("preflight", help="Check configured execution; live inference requires --probe")
    flight_p.add_argument("--profile")
    flight_p.add_argument("--role", required=True, choices=VALID_ROLES)
    flight_p.add_argument("--probe", action="store_true", help="Opt in to a billed, tool-denied Copilot inference probe")
    launch_p = subparsers.add_parser("prepare-launch", help="Validate authorization and print pinned Orca argv; does not launch")
    launch_p.add_argument("--profile")
    launch_p.add_argument("--role", required=True, choices=VALID_ROLES)
    launch_p.add_argument("--assigned-by", required=True)
    launch_p.add_argument("--assigner-evidence")
    launch_p.add_argument("--report-to")
    launch_p.add_argument("--assignment-id", required=True)
    launch_p.add_argument("--task", required=True)
    launch_p.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    launch_p.add_argument("--terminal-worktree", type=Path, help="Create the terminal in this worktree; the binding still lands in the workspace root")
    launch_p.add_argument("--cli", help="One-off CLI override for this launch (recorded as differing from the profile)")
    launch_p.add_argument("--model", help="One-off model override")
    launch_p.add_argument("--effort", help="One-off effort override")
    dcheck_p = subparsers.add_parser("dispatch-check", help="Engineer self-check: dispatch must reference an existing ticket and plan")
    dcheck_p.add_argument("--ticket", default="")
    dcheck_p.add_argument("--plan", default="")
    dcheck_p.add_argument("--trivial", default="", help="Reason this is a trivial change (typo, copy, single config value, QA retry within an approved plan); skips the plan requirement")
    dcheck_p.add_argument("--tools-config", type=Path, default=DEFAULT_TOOLS_PATH)
    for seat_parser in (boot_p, rebind_p, stat_p, pre_p, rev_p, launch_p):
        seat_parser.add_argument("--seat", type=int, default=1, help="Seat number for multi-seat roles (Engineer, QA); default 1")
    for profile_parser in (boot_p, rebind_p, stat_p, pre_p, profiles_val_p, select_p, show_p, flight_p, launch_p):
        profile_parser.add_argument("--profiles-config", type=Path, default=DEFAULT_PROFILES_PATH)

    args = parser.parse_args()
    ws_override = getattr(args, "workspace_root", None)

    try:
        if args.command == "validate-profiles":
            data = load_profiles(args.profiles_config, ws_override)
            print(json.dumps({"status": "valid", "profiles": list(data["profiles"])}, indent=2))
            sys.exit(0)

        elif args.command == "profile-select":
            profile = select_profile(args.profile, args.profiles_config, ws_override)
            print(json.dumps({"status": "selected", **profile, "staffedRoles": staffed_roles(profile), "message": "Existing sessions were not changed or model-verified."}, indent=2))
            sys.exit(0)

        elif args.command in ("profile-show", "preflight", "prepare-launch"):
            profile = resolve_profile(args.profiles_config, ws_override, args.profile)
            if args.command == "profile-show":
                print(json.dumps({**profile, "staffedRoles": staffed_roles(profile)}, indent=2))
                sys.exit(0)
            if args.command == "preflight":
                result = preflight_profile(profile, args.role, ws_override, args.probe)
                print(json.dumps(result, indent=2))
                sys.exit(0 if result["status"] == "inference_verified" else 1)
            result = prepare_launch(
                profile, args.role, args.assigned_by, args.assigner_evidence, args.report_to,
                args.assignment_id, args.task, args.config, ws_override, args.profiles_config,
                seat=args.seat, terminal_worktree=args.terminal_worktree,
                override={"cli": args.cli, "model": args.model, "effort": args.effort},
            )
            print(json.dumps(result, indent=2, ensure_ascii=False))
            sys.exit(0)

        elif args.command == "validate-config":
            data, digest = load_and_validate_config(args.config, ws_override)
            print(f"✓ Configuration is valid! (Revision: {data['revision']}, Digest: {digest[:16]}...)")
            sys.exit(0)

        elif args.command in ("bootstrap", "rebind"):
            res = bootstrap_role(
                role=args.role,
                assigned_by=args.assigned_by,
                assignment_id=getattr(args, "assignment_id", None),
                assigner_evidence=getattr(args, "assigner_evidence", None),
                report_to=getattr(args, "report_to", None),
                terminal_handle=getattr(args, "terminal_handle", None),
                runtime_id=getattr(args, "runtime_id", None),
                orca_session_id=getattr(args, "session_id", None),
                config_path=args.config,
                workspace_root=ws_override,
                allow_offline=getattr(args, "allow_offline", False),
                force=getattr(args, "force", False),
                profiles_path=args.profiles_config,
                seat=args.seat,
            )
            print(f"✓ Role '{args.role}' processed (Status: {res['status']})!")
            print(json.dumps(res, indent=2, ensure_ascii=False))
            sys.exit(0 if res["status"] == "bound" else 1)

        elif args.command == "status":
            res = get_role_status(
                role=args.role,
                config_path=args.config,
                workspace_root=ws_override,
                caller_handle=getattr(args, "caller_handle", None),
                allow_offline=getattr(args, "allow_offline", False),
                profiles_path=args.profiles_config,
                seat=args.seat,
            )
            if args.json:
                print(json.dumps(res, indent=2, ensure_ascii=False))
            else:
                print(f"Role: {res['role']} | Status: {res['status']}")
                if "message" in res:
                    print(f"Message: {res['message']}")
                if "binding" in res:
                    print("Active Binding:")
                    for k, v in res["binding"].items():
                        print(f"  {k}: {v}")
            sys.exit(0 if res["status"] == "bound" else 1)

        elif args.command == "preamble":
            txt = generate_preamble(
                role=args.role,
                config_path=args.config,
                workspace_root=ws_override,
                caller_handle=getattr(args, "caller_handle", None),
                allow_offline=getattr(args, "allow_offline", False),
                profiles_path=args.profiles_config,
                seat=args.seat,
            )
            print(txt)
            sys.exit(0)

        elif args.command == "revoke":
            ok = revoke_role(args.role, workspace_root=ws_override, seat=args.seat)
            if ok:
                print(f"✓ Role '{args.role}' revoked.")
            else:
                print(f"Notice: No active binding found for role '{args.role}'.")
            sys.exit(0)

        elif args.command == "dispatch-check":
            result = dispatch_check(args.ticket, args.plan, args.tools_config, ws_override, args.trivial)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            sys.exit(0 if result["ok"] else 1)

        elif args.command == "verify-route":
            ok, msg = verify_dispatch_route(args.handle, allow_offline=getattr(args, "allow_offline", False))
            if ok:
                print(f"✓ Route valid: {msg}")
                sys.exit(0)
            else:
                print(f"❌ Route invalid: {msg}", file=sys.stderr)
                sys.exit(1)

    except IdentityError as e:
        print(f"❌ Error [{type(e).__name__}]: {e}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(f"❌ Unexpected Error: {e}", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
