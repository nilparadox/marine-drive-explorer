#!/bin/bash
# Serves Marine Drive Explorer on http://localhost:8795 (index.html also opens straight from disk)
cd "$(dirname "$0")"
open "http://localhost:8795/" 2>/dev/null
python3 -m http.server 8795 --bind 127.0.0.1
