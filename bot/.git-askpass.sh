#!/bin/sh
# GIT_ASKPASS helper: answers GitHub HTTPS auth from env, so the token never
# appears on the command line or in git config. Requires GITHUB_TOKEN set.
case "$1" in
  *Username*) exec printf '%s' "x-access-token" ;;
  *) exec printf '%s' "$GITHUB_TOKEN" ;;
esac
exec printf '%s' "$GITHUB_TOKEN"
