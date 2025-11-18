#!/usr/bin/env bash
git config --global --unset http.proxy || true
git config --global --unset https.proxy || true
echo "CI precheck: cleared git proxy"
