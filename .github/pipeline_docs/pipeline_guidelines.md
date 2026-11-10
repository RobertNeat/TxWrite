# Założenia pipelinów CI-CD

Wielozadaniowe pipeliny CI/CD w oparciu o GitHub Actions, które wykonują akcje prowadzące do osiągnięcia celu (wdrożenia na serwerze, stworzenia wydania) dla wielu technologii w repozytoriach monorepo lub multirepo

| Github       | GitLab        |
| ------------ | ------------- |
| Pull Request | Merge Request |
| --------     | --------      |
| Workflow     | Pipeline      |
| Job          | Stage         |
| Steps        | Job           |

---

Pipeline CI/CD:

1. działają w oparciu o GitHub Actions
2. są uruchamiane we własnym środowisku (self-hosted github-runner) na Proxmox
3. wykonują akcje porowadzące do osiągnięcia celu (weryfikacji, wdrożenia na serwerze, stworzenia wydania)
4. szablon pipeline są uniwersalne i mogą być stosowane z technologiami (Node.js (Angular, NestJS), Spring Boot (Java), Python) w repozytoriach monorepo lub multirepo

Zależności (narzędzia) wykorzystywane w pipeline'ach CI/CD:

- mise (instalator środowisk uruchomieniowych Node.js, Java, Python)
- uv (narzędzie do budowania aplikacji Python)
- semgrep (statyczna analiza kodu SAST)
- trivy (analiza bezpieczeństwa, podatności)

Środowiska:

1. produkcyjne - serwer homelab
2. wydanie - rejestr obrazów docker (ghcr.io)

Ścieżki działania pipeline:

0. Ścieżka testowa (pre_merge_check) - sprawdza kod aplikacji, uruchamia testy jednostkowe i test budowania aplikacji
   `check`
1. Ścieżka wdrożeniowa (production_deployment) - sprawdza kod aplikacji, buduje obrazy i uruchamia wskazany commit na serwerze
   `check -> build -> deploy`
2. Ścieżka wydania (release_ghcr) - sprawdza kod aplikacji, wysyła obrazy do rejestru docker i tworzy GitHub Release o nazwie taga
   `build -> release -> github_release`

Wyróżniamy pipeline'y:

- **check** - sprawdzenie jakości kodu, sprawdzenie zależności, testy bezpieczeństwa, SAST, testy jednostkowe i test budowania aplikacji,
- **build** - zbudowanie obrazu docker, scan obrazu za pomocą Trivy i push do lokalnego rejestru z tagiem pełnego SHA,
- **deploy** - uruchomienie zestawu obrazów o tym samym SHA w środowisku produkcyjnym,
- **release** - pobranie zestawu obrazów wskazanego przez tag `release_x.y.z` i push do ghcr.io,
- **github_release** - utworzenie GitHub Release o nazwie identycznej jak tag `release_x.y.z` po poprawnym opublikowaniu wszystkich obrazów w GHCR.

---

Wyzwalacze które wyróżniamy (uruchamiają pipeline'y):

- `push` do jakiejkolwiek gałęzi - uruchamia ścieżkę testową (check) dla każdej aplikacji w repozytorium,

  ```yaml
  on:
    push:
      branches:
        - "**"
        - "!release_*"
        - "!deploy_*"
    pull_request:
      branches:
        - main
        - master
  ```

  pomija gałęzie release*\* i deploy*\*, które są mogą być używane jako gałęzie archiwalne kodu repozytorium w przyszłości

- ręczne uruchomienie `pre_merge_check` (`workflow_dispatch`) - uruchamia ten sam check dla wskazanego refa workflow,

- `push` do gałęzi main lub master albo ręczne uruchomienie `production_deployment` - uruchamia ścieżkę wdrożeniową (`check->build->deploy`) na lokalny serwer produkcyjny; ręczne uruchomienie może wskazać pełny SHA commita,

  ```yaml
  on:
    push:
      branches:
        - main
        - master
  ```

- push taga w konwencji `release_x.y.z`, publikacja GitHub Release albo ręczne wywołanie z istniejącym tagiem uruchamia wydanie całego zestawu aplikacji. Digest i SHA nie są ręcznymi parametrami wydania. Przy ręcznym wywołaniu lub pushu taga workflow buduje obrazy dla commita taga, publikuje je do GHCR, a następnie tworzy GitHub Release o nazwie takiej samej jak tag. Jeżeli workflow został uruchomiony przez już opublikowany GitHub Release, etap `github_release` potwierdza istniejące wydanie i nie tworzy duplikatu.

```yaml
on:
  push:
    tags:
      - "release_*.*.*"

  release:
    types:
      - published

  workflow_dispatch:
    inputs:
      release_tag:
        description: "Istniejący tag release_x.y.z"
        required: true
        type: string
```

Tag wydania wskazuje jeden commit SHA i wspólny zestaw obrazów. Wszystkie operacje workflow są wykonywane na wszystkich aplikacjach repozytorium.

---

Struktura katalogów w katalogu .github:

```bash
.github/
├── workflows/
│   ├── pre_merge_check.yaml
│   ├── release_ghcr.yaml
│   ├── production_deployment.yaml
│   ├── _job_check.yaml
│   ├── _job_build.yaml
│   └── _job_deploy.yaml
│
├── docker/
│   ├── angular.Dockerfile
│   ├── node.Dockerfile
│   ├── python.Dockerfile
│   └── spring.Dockerfile
│
├── steps/
│   ├── check_node.sh
│   ├── check_python.sh
│   ├── check_spring.sh
│   ├── validate_projects.sh
│   ├── create_docker_image.sh
│   ├── scan_docker_image.sh
│   ├── push_local_image.sh
│   ├── push_image_ghcr.sh
│   ├── cleanup_runner_images.sh
│   └── deploy_compose_ssh.sh
│
└── ci/
    ├── README.md
    └── projects.json

deploy/
└── <nazwa pliku z deploy.compose_file w projects.json>
```

Pliki `_job_*.yaml` są reużywalnymi szablonami dla szablonami worklow używanymi jako definicje porcji poszczególnych jobów (każda definicja workflow może wykonywać sekwencyjnie lub równolegle wiele jobów).
Pliki w katalogu `steps` są poszczególnymi krokami w postaci skryptów bash, które wykonują poszczególne kroki w jobach workflow.
Katalog `.github/docker` zawiera bazowe Dockerfile używane przez konfigurację aplikacji.
Katalog `.github/ci` zawiera kontrakt konfiguracji aplikacji i plik `projects.json`.

---

Reguły działania workflow w kontekście repozytorium monorepo:

- każdy workflow produkcyjny operuje na wszystkich aplikacjach w repozytorium
- poszczególne workflow'y (check, build, deploy, release) są uruchamiane dopiero po wykonaniu wszystkich jobów poprzedniego workflow na wszystkich aplikacjach w repozytorium
- tag oparty na pełnym SHA commita nigdy nie jest nadpisywany,
- każdy workflow jest wywoływany na wszystkich aplikacjach w repozytorium (wszystko albo nic, nawet w przypadku deployment),
- każdy obraz który trafi do lokalnego rejestru obrazów jest zawsze dostępny (na wypadek ręcznego rollback),
- `latest` nie jest używany w workflow,
- po buildzie runner zachowuje jeden lokalny obraz każdej aplikacji; cache budowania nie jest czyszczony,
- po deploymencie usuwane są tylko stare kontenery i lokalne obrazy tego projektu; usuwa to także logi starych kontenerów, ale nie dotyka wolumenów ani registry,
- joby pomocnicze mają timeout 3-5 minut, check 10 minut, build 15 minut, a publikacja do GHCR 10 minut,
- ścieżki build/deploy i release są serializowane, aby wzajemnie nie usuwały swoich lokalnych obrazów.

Definicja projektu (obsługiwanych aplikacji w repo) - pipeline ma obsługiwać wszystkie aplikacje w repozytorium przy zmianie nawet tylko jednej z nich.

Szczegółowy kontrakt pól, szablony nowych aplikacji i checklistę dodawania wpisów opisuje `.github/ci/README.md`.

1. należy zdefiniować w `.github/ci/projects.json` dla każdej aplikacji pełny zestaw pól wymagany przez walidator `.github/steps/validate_projects.sh`.
2. `version` oznacza zawsze wersję środowiska uruchomieniowego dla wybranej technologii:
   - `type: node` -> wersja Node.js
   - `type: springboot` -> wersja Java (major version); CI używa Eclipse Temurin przez `mise`
   - `type: python` -> wersja Python
3. aplikacja Node udostępnia skrypt jakości wskazany przez `check_script`; pipeline jedynie uruchamia przekazaną nazwę skryptu. Dobór lintera, formatowania, typechecku, testów i argumentów CLI pozostaje częścią aplikacji.

---
