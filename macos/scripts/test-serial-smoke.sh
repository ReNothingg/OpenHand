#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
TEST_BINARY=$(mktemp /tmp/openhand-serial-smoke.XXXXXX)
HOST_ARCH=$(uname -m)

trap 'rm -f "$TEST_BINARY"' EXIT

CLANG_MODULE_CACHE_PATH=/tmp/openhand-module-cache \
SWIFT_MODULECACHE_PATH=/tmp/openhand-swift-cache \
swiftc \
  -parse-as-library \
  -target "$HOST_ARCH-apple-macosx13.0" \
  "$PROJECT_DIR/macos/openhand/SerialConnection.swift" \
  "$PROJECT_DIR/macos/tests/SerialConnectionSmoke.swift" \
  -o "$TEST_BINARY"

"$TEST_BINARY"
