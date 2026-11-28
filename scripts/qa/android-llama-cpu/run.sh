#!/usr/bin/env bash
set -euo pipefail

test_dir=$(cd "$(dirname "$0")" && pwd)
mobile_dir="$test_dir/../../../apps/mobile"
llama_dir=$(cd "$mobile_dir" && node -p 'require("node:path").dirname(require.resolve("llama.rn/package.json"))')
classes=$(mktemp -d)
trap 'rm -rf "$classes"' EXIT

javac --release 8 -d "$classes" \
  "$llama_dir/android/src/main/java/com/rnllama/Arm64LibrarySelector.java" \
  "$test_dir/Arm64LibrarySelectorTest.java"
java -cp "$classes" com.rnllama.Arm64LibrarySelectorTest
