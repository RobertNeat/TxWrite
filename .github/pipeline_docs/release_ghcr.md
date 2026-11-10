# `release_ghcr`

## Uruchomienie

- `push` taga `release_X.Y.Z`;
- opublikowanie GitHub Release;
- ręcznie przez `workflow_dispatch` z istniejącym tagiem `release_X.Y.Z`.

## Cel i kroki

Publikuje w GHCR obraz TxWrite wskazany przez tag. Workflow korzysta z
reużywalnego builda, ale nie uruchamia osobnego `pre_merge_check`:

1. `context` sprawdza tag i rozwiązuje go do pełnego SHA commita;
2. `build` buduje, skanuje i zapisuje obraz lokalnie;
3. macierz `release` (obecnie jeden wpis, `txwrite`) publikuje obraz do
   `ghcr.io/<owner>/<image>:X.Y.Z`;
4. `github_release` tworzy GitHub Release o nazwie taga lub potwierdza
   istniejące wydanie.

Macierz zostaje z `_job_build.yaml`/`release_ghcr.yaml`, nawet z jednym
wpisem w `projects.json` — jeśli repozytorium kiedyś zyska drugi
niezależnie wdrażany obraz, nie wymaga to zmian w workflow, tylko dopisania
wpisu w `projects.json`.

Tag jest jedynym identyfikatorem wersji wydania; SHA i digest są wyznaczane
automatycznie. Publikacja wymaga uprawnień `packages: write` i `contents: write`.
