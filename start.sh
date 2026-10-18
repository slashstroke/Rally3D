#!/bin/sh
# Rally 3D native port - launcher (macOS / Linux)
cd "$(dirname "$0")"
( sleep 2; xdg-open http://localhost:8088/game/index.html 2>/dev/null \
  || open http://localhost:8088/game/index.html 2>/dev/null ) &
python3 serve.py 8088
