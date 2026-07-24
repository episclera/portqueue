#!/usr/bin/env bash
#
# PreToolUse hook — hard-block git branch creation.
#
# CLAUDE.md forbids the assistant from ever creating a git branch unless the user
# explicitly asks for it in a prompt. That rule is only guidance to the model; this
# hook enforces it at the tool-call layer so a branch can never be created by
# accident. It inspects every Bash command and denies the call when it would create
# a branch (git checkout -b, git switch -c, git worktree add -b, git branch <name>,
# git branch -c/--copy).
#
# Exit 0 -> allow. Exit 2 -> block the tool call and feed stderr back to the model.
#
# NOTE: this is a safety net, not a substitute for the CLAUDE.md rule. If the user
# explicitly asked for a branch, they should run the command themselves.

set -euo pipefail
set -f  # disable globbing so tokens like '*' are never expanded while parsing

input="$(cat)"

tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ "$tool" = "Bash" ] || exit 0

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$cmd" ] || exit 0

deny() {
  {
    echo "BLOCKED: creating a git branch is not allowed."
    echo "Reason: $1"
    echo "Per CLAUDE.md, only the user may create a branch, and only when they explicitly ask for it."
    echo "If the user explicitly requested this branch, ask them to run the command themselves."
  } >&2
  exit 2
}

# Returns 0 (true) when a single command segment would create a git branch.
segment_creates_branch() {
  local seg="$1"
  local -a t
  IFS=' ' read -ra t <<<"$seg"
  local n=${#t[@]} i

  # Find the `git` token.
  local gi=-1
  for ((i = 0; i < n; i++)); do
    if [ "${t[i]}" = "git" ]; then gi=$i; break; fi
  done
  [ "$gi" -ge 0 ] || return 1

  # Subcommand = first non-option token after `git`.
  local sub="" si=-1
  for ((i = gi + 1; i < n; i++)); do
    case "${t[i]}" in
      -*) ;;  # git global option, skip
      *) sub="${t[i]}"; si=$i; break ;;
    esac
  done
  [ -n "$sub" ] || return 1

  case "$sub" in
    checkout)
      for ((i = si + 1; i < n; i++)); do
        case "${t[i]}" in -b | -B) return 0 ;; esac
      done
      ;;
    switch)
      for ((i = si + 1; i < n; i++)); do
        case "${t[i]}" in -c | -C | --create | --force-create) return 0 ;; esac
      done
      ;;
    worktree)
      # `git worktree add -b/-B <name>` creates a branch.
      local is_add=0
      for ((i = si + 1; i < n; i++)); do
        [ "${t[i]}" = "add" ] && is_add=1
        case "${t[i]}" in -b | -B) [ "$is_add" = 1 ] && return 0 ;; esac
      done
      ;;
    branch)
      # `git branch <name> [start]` creates; `git branch -c/--copy` copies (also creates).
      # Listing / deleting / renaming / reading do not create anything.
      local has_positional=0 has_readonly=0 has_copy=0
      for ((i = si + 1; i < n; i++)); do
        case "${t[i]}" in
          -c | -C | --copy) has_copy=1 ;;
          --set-upstream-to | --sort | --format | --contains | --no-contains | --merged | --no-merged | --points-at)
            has_readonly=1; i=$((i + 1)) ;;  # option that consumes the next arg
          -d | -D | --delete | -m | -M | --move | --list | -a | --all | -r | --remotes | \
            -v | -vv | --verbose | --show-current | --edit-description | --unset-upstream | \
            --set-upstream-to=* | --format=* | --sort=* | --merged=* | --contains=*)
            has_readonly=1 ;;
          -*) ;;  # any other option: ignore
          *) has_positional=1 ;;
        esac
      done
      if [ "$has_copy" = 1 ] || { [ "$has_positional" = 1 ] && [ "$has_readonly" = 0 ]; }; then
        return 0
      fi
      ;;
  esac
  return 1
}

# Normalise newlines/tabs to spaces, then split on shell separators (&& || | ;) so a
# branch-creating git call chained after another command is still inspected.
norm="$(printf '%s' "$cmd" | tr '\n\t' '  ')"
segments="$(printf '%s' "$norm" | sed -E 's/(\&\&|\|\||[;|])/\n/g')"

while IFS= read -r seg; do
  [ -n "$seg" ] || continue
  if segment_creates_branch "$seg"; then
    trimmed="$(printf '%s' "$seg" | sed 's/^ *//;s/ *$//')"
    deny "the command segment '$trimmed' would create a branch."
  fi
done <<EOF
$segments
EOF

exit 0
