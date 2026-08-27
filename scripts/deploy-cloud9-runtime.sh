#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." && pwd -P)"
origin_url="${MATTA_GIT_URL:-$(git -C "${repo_root}" remote get-url origin)}"
runtime_dir="${MATTA_RUNTIME_DIR:-${HOME}/environment/matta-runtime}"
runtime_parent="$(dirname -- "${runtime_dir}")"
runtime_name="$(basename -- "${runtime_dir}")"
temporary_dir="$(mktemp -d /tmp/matta-cloud9-runtime.XXXXXX)"
staging_dir=""
backup_dir=""

cleanup() {
  rm -rf -- "${temporary_dir}" || true
  if [ -n "${staging_dir}" ]; then
    rm -rf -- "${staging_dir}" || true
  fi
  if [ -n "${backup_dir}" ] && [ ! -e "${runtime_dir}" ]; then
    mv -- "${backup_dir}" "${runtime_dir}" || true
  fi
}
trap cleanup EXIT

mkdir -p -- "${runtime_parent}"
if { [ -e "${runtime_dir}" ] || [ -L "${runtime_dir}" ]; } && [ ! -d "${runtime_dir}" ]; then
  printf '実行用ディレクトリではありません: %s\n' "${runtime_dir}" >&2
  exit 1
fi

bare_repo="${temporary_dir}/runtime.git"
staging_dir="$(mktemp -d "${runtime_parent}/.${runtime_name}.staging.XXXXXX")"
git init --bare --quiet "${bare_repo}"
git -C "${bare_repo}" fetch --depth=1 "${origin_url}" \
  refs/heads/cloud9-runtime:refs/heads/cloud9-runtime
git -C "${bare_repo}" show \
  refs/heads/cloud9-runtime:matta-standalone-linux-x64.tar.gz | \
  tar -xzf - -C "${staging_dir}"
test -f "${staging_dir}/server.js"

if [ -f "${runtime_dir}/.env.local" ]; then
  cp -p -- "${runtime_dir}/.env.local" "${staging_dir}/.env.local"
  chmod 600 "${staging_dir}/.env.local"
fi

if [ -e "${runtime_dir}" ] || [ -L "${runtime_dir}" ]; then
  backup_dir="$(mktemp -d "${runtime_parent}/.${runtime_name}.previous.XXXXXX")"
  rmdir -- "${backup_dir}"
  mv -- "${runtime_dir}" "${backup_dir}"
fi
mv -- "${staging_dir}" "${runtime_dir}"
staging_dir=""

if [ -n "${backup_dir}" ]; then
  rm -rf -- "${backup_dir}"
  backup_dir=""
fi

printf 'Cloud9 runtimeを配置しました: %s\n' "${runtime_dir}"
printf '起動: cd %s && PORT=8080 HOSTNAME=0.0.0.0 node server.js\n' "${runtime_dir}"
