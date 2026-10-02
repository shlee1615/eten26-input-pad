#!/bin/zsh
set -eu
cd "${0:A:h:h}"
node --test input-pad/pad-core.test.cjs input-pad/pad-settings.test.cjs input-pad/settings-ui.test.cjs input-pad/return-ui.test.cjs input-pad/pad-ui.test.cjs input-pad/input-regression.test.cjs
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp/}eten26-tests.XXXXXX")
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc input-pad/delivery-flow.swift input-pad/delivery-tests/main.swift -o "$TEST_DIR/delivery"
"$TEST_DIR/delivery"
swiftc input-pad/return-policy.swift input-pad/return-policy-tests/main.swift -o "$TEST_DIR/policy"
"$TEST_DIR/policy"
swiftc input-pad/settings-store.swift input-pad/store-tests/main.swift -o "$TEST_DIR/settings"
"$TEST_DIR/settings"
