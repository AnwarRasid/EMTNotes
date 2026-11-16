# Question import log

Written by `py tools/import_questions.py` on every run. Do not edit by hand.

## Sources

- EMT Medical & Trauma Question Bank 2017.pdf: sha256 d9d8da3334d057ef50e38b6d352d881c495c5f5695cee07120e19ac707c08b76
- HMLS Question Bank for EMT-CT, MOCT & HRCT-C.pdf: sha256 e2c32d6d6247d923f848a96938bb860e50eaa3dc35833b718350fc0ae602a3d4

## Questions per bank

- mt-a: 92
- mt-b: 254
- hmls: 61
- total: 407

## Review flags

- mt-b-q168 (duplicate-label): The bank printed the letter A on two options.
- mt-b-q169 (duplicate-text): Two options have the same text.
- mt-b-q197 (image): Depends on the ECG strip printed in the PDF. Check the crop against the PDF.
- mt-b-q198 (image): Depends on the ECG strip printed in the PDF. Check the crop against the PDF.
- mt-b-q199 (image): Depends on the ECG strip printed in the PDF. Check the crop against the PDF.

## Fixes applied

- mt-b-q203: treament → treatment
- mt-b-q207: asculatation → auscultation
- mt-b-q209: dysarhythmias → dysrhythmias
- mt-b-q212: puritus → pruritus
- mt-b-q254: eithical → ethical
- hmls-q004: indefinetly → indefinitely
- hmls-q058: I/min → L/min
- hmls-q059: I/min → L/min
- hmls-q060: I/min → L/min

## Fixes not applied

None.

## Stale explanations

None.

## Unplaced lines

None.
