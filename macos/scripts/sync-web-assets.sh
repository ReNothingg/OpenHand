#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
SOURCE_DIR="$PROJECT_DIR/dist"
TARGET_DIR="$PROJECT_DIR/macos/Web"

if [ ! -f "$SOURCE_DIR/index.html" ]; then
  echo "Сначала соберите веб-приложение: npm run build" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "$SOURCE_DIR"/. "$TARGET_DIR"/

echo "Ресурсы macOS синхронизированы: $TARGET_DIR"
