# Contributing & Developer Workflow Guide

This document defines the contribution, branching, and worktree standards for this repository.

## 1. Development Trunk & Branching Model
- **Trunk**: Active development takes place on the main integration trunk (e.g. `main` or `dev`).
- **Task Isolation**: Develop features and bugfixes in dedicated worktrees (`.worktrees/<task-name>`) on task branches (`feat/<task-name>`).

## 2. Operation Autonomy & Two-Way Door Principle
- **Two-Way Door (Reversible)**: Autonomous execution for tests, branch switches, and cleanly merged worktree deletions.
- **One-Way Door (Destructive)**: Explicit user consent required before running destructive commands (`rm -rf`, `git reset --hard`, `git push --force`).

## 3. Testing Scope
- Run only relevant tests during active development; run full test suite before trunk merge or release.
