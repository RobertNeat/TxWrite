# Dokumentacja pipeline CI/CD

Ten katalog opisuje sposób użycia pipeline w tym repozytorium (TxWrite);
szczegółowy kontrakt pól pozostaje w `ci/README.md`. `.github` jest
szablonem wspólnym dla wielu projektów (`pipeline_guidelines.md`) i może być
skopiowany do innego repozytorium — po skopiowaniu zacznij od
[konfiguracji aplikacji](../ci/README.md), a następnie uzupełnij
[`../ci/projects.json`](../ci/projects.json).

## Zawartość

- [Założenia ogólne](overview.md)
- [Pre-merge check](pre_merge_check.md)
- [Production deployment](production_deployment.md)
- [Release GHCR](release_ghcr.md)
- [Konfiguracja aplikacji](../ci/README.md)

## Szybka integracja w nowym repozytorium

1. Skopiuj `.github` do katalogu głównego repozytorium.
2. W `.github/ci/projects.json` ustaw `pipeline.project_roots`, runnera oraz
   wpis każdego bezpośredniego katalogu aplikacji.
3. Dla każdej aplikacji wskaż istniejący Dockerfile, obraz, porty i parametry
   technologii zgodnie z [kontraktem konfiguracji](../ci/README.md).
4. Dla wdrożenia ustaw sekcję `deploy`, przygotuj wskazany Compose/config oraz
   sekrety i environment GitHub wymagane przez dostęp SSH i rejestr obrazów.
5. Uruchom walidację: `bash .github/steps/validate_projects.sh .github/ci/projects.json`.

Pipeline obsługuje wszystkie aplikacje opisane w `projects.json`; zmiana jednej
aplikacji uruchamia operację dla całego zestawu.
