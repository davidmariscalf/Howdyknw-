#!/usr/bin/env bash
set -euo pipefail

# Signing must happen on the owner's computer with Samsung Tizen Studio.
# This script never copies/signs credentials to a remote service.
if [[ $# -ne 1 || -z "$1" ]]; then
  echo 'Uso: bash tizen-tv/package-with-profile.sh NOMBRE_DE_PERFIL_SAMSUNG' >&2
  echo 'Primero crea el certificado con Tizen Studio Certificate Manager (incluye DUID de la TV).' >&2
  exit 2
fi

if ! command -v tizen >/dev/null 2>&1; then
  echo 'No se encuentra Tizen Studio CLI. Instala Tizen Studio + Samsung TV y Certificate Extensions.' >&2
  exit 1
fi

PROFILE="$1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tizen build-web -- "$HERE"
tizen package -t wgt -s "$PROFILE" -- "$HERE/.buildResult"
echo 'Paquete WGT firmado generado en el directorio .buildResult. Comprueba que el DUID de tu TV está autorizado.'
