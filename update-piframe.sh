#!/usr/bin/env bash

set -euo pipefail

cd /opt/piframe
git status --short
git pull --ff-only
npm ci
npm run build
sudo systemctl restart piframe.service
