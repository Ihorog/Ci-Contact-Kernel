# CI Contact Kernel Spec

Ci Contact Kernel is implemented as a minimal universal control core:

`signal → contact → classification → routing → permission gate → execution center → verification → memory → new signal`

The runtime is a lightweight Node.js + Express service with deterministic local stubs for unsafe external operations.
