#!/bin/bash
# Testa a lógica pura (torneio, agregação, EXIF, zip, originais) e o backend demo. Não toca no Supabase.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" && node --test tests/*.test.js "$@"
