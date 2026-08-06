#!/usr/bin/env bash

# Docker Compose expands $NAME and ${NAME} in unquoted and double-quoted env
# values. Single quotes are literal; Compose represents an embedded apostrophe
# as \'. Reject line breaks so one value can never create another assignment.
compose_env_literal() {
  if [ "$#" -ne 1 ] || [[ "$1" == *$'\n'* ]] || [[ "$1" == *$'\r'* ]]; then
    return 1
  fi
  local escaped
  escaped="$(printf '%s' "$1" | sed "s/'/\\\\'/g")"
  printf "'%s'" "${escaped}"
}
