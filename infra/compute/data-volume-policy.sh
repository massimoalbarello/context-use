context_use_data_volume_action() {
  local filesystem="$1"
  local initialization_authorized="$2"
  local initialization_recorded="$3"

  if [ -n "${filesystem}" ]; then
    if [ "${filesystem}" = "xfs" ]; then
      printf '%s\n' use-existing
    else
      printf '%s\n' reject-filesystem
    fi
    return
  fi

  if [ "${initialization_recorded}" = "true" ]; then
    printf '%s\n' reject-reinitialization
  elif [ "${initialization_authorized}" = "true" ]; then
    printf '%s\n' initialize
  else
    printf '%s\n' reject-uninitialized
  fi
}
