# `pre_merge_check`

## Uruchomienie

- `push` do każdej gałęzi poza `release_*` i `deploy_*`;
- `pull_request` do `main` lub `master`;
- ręcznie przez `workflow_dispatch`.

## Cel i kroki

Weryfikuje kod przed scaleniem. Workflow uruchamia reużywalny
`.github/workflows/_job_check.yaml`, który:

1. waliduje `.github/ci/projects.json`;
2. tworzy macierz aplikacji (obecnie jeden wpis, `txwrite`, cały workspace
   pnpm pod `path: "."`);
3. uruchamia check Node.js wskazany przez `check_script`.

Dla `txwrite` to skrypt `check` z katalogu głównego (`pnpm run check`), który
uruchamia `verify` (lint, typecheck, format:check, test — oba workspace
pakiety, `backend` i `frontend`) a następnie `build` dla obu. Dobór lintera
(`oxlint`), testów (`vitest`/`ng test`) i argumentów CLI pozostaje częścią
aplikacji; pipeline jedynie wywołuje nazwę skryptu.

Po skrypcie Node pipeline uruchamia `trivy fs` (podatności w zależnościach) i
`semgrep scan --config auto` — dla `path: "."` obejmuje to cały workspace,
łącznie z `.github/**` i `deploy/**`, nie tylko kod aplikacji.
