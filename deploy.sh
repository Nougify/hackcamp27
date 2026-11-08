#!/bin/sh
set -e
cd ~/hackcamp27
git pull
docker compose up -d --build
docker image prune -f
docker compose ps
