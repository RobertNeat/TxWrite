# Konfiguracja `.github/ci/projects.json`

Plik `.github/ci/projects.json` jest jednym zrodlem prawdy dla pipeline CI/CD.
Workflowy czytaja z niego liste aplikacji, etykiety runnera, dane deploymentu
oraz parametry potrzebne do testowania, budowania obrazow Docker, skanowania i
wdrozenia.

Kazda aplikacja z katalogow wskazanych w `pipeline.project_roots` musi byc
opisana w tablicy `projects` dokladnie raz. Walidator
`.github/steps/validate_projects.sh` porownuje katalogi wykryte w tych rootach z
wartosciami `projects[].path`, dlatego po dodaniu nowej aplikacji sam katalog
nie wystarczy - trzeba dopisac jej definicje w `projects.json`.

**`pipeline.project_roots: []` (monorepo z jednym obrazem)**: gdy repozytorium
buduje sie w jeden obraz Docker z calego workspace (np. `path: "."`, jak w
tym repozytorium - patrz `projects.json`), katalogowe discovery nie ma sensu
(nie istnieje jeden katalog "per aplikacja" do wykrycia). Pusta tablica
wylacza ten konkretny check walidatora; `projects` nadal opisuje jawnie kazdy
wdrazany obraz.

## Struktura pliku

```json
{
  "schema_version": 2,
  "pipeline": {
    "runner_labels": ["self-hosted", "Linux", "X64", "production"],
    "project_roots": ["apps"]
  },
  "projects": [],
  "deploy": {
    "environment": "production",
    "host": "192.168.1.160",
    "user": "docker_deploy",
    "registry": "192.168.1.162:5000",
    "compose_file": "deploy/compose.yml",
    "config_file": "deploy/config.env",
    "remote_dir": "/home/docker_deploy/projekt-testowy-pipeline"
  }
}
```

## Sekcja `pipeline`

| Pole            | Typ        | Opis                                                                                                    |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `runner_labels` | `string[]` | Etykiety self-hosted runnera uzywane przez joby generowane z konfiguracji.                              |
| `project_roots` | `string[]` | Katalogi, w ktorych pipeline szuka aplikacji. Kazdy bezposredni podkatalog musi miec wpis w `projects`. |

## Sekcja `projects`

Kazdy wpis projektu musi miec dokladnie ponizsze pola.

| Pole               | Typ                  | Wymagania i znaczenie                                                                                                                                                                        |
| ------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | `string`             | Unikalna nazwa aplikacji w pipeline. Powinna byc stabilna, bo pojawia sie w nazwach jobow i jest uzywana do wyliczania nazw zmiennych pomocniczych.                                          |
| `type`             | `string`             | Technologia aplikacji. Dozwolone wartosci: `node`, `python`, `springboot`.                                                                                                                   |
| `framework`        | `string`             | Framework lub wariant technologii, np. `angular`, `nestjs`, `stdlib`, `springboot`. Dla `angular` obowiazuja dodatkowe pola statycznego serwera.                                             |
| `version`          | `string`             | Wersja runtime: Node.js dla `node`, Python dla `python`, major Java dla `springboot`. Spring Boot uzywa Eclipse Temurin przez `mise`.                                                        |
| `path`             | `string`             | Relatywna sciezka do katalogu aplikacji. Musi istniec i nie moze zaczynac sie od `/`.                                                                                                        |
| `package_manager`  | `string` albo `null` | Dla `node`: `pnpm`, `npm` albo `yarn`. Dla `python` i `springboot`: `null`.                                                                                                                  |
| `build_tool`       | `string` albo `null` | Dla `springboot`: `maven` albo `gradle`. Dla `python`: niepusty opis narzedzia budowania, obecnie `setuptools`. Dla `node`: `null`.                                                          |
| `check_script`     | `string` albo `null` | Dla `node`: nazwa skryptu z `package.json`, np. `check`. Dla innych typow: `null`.                                                                                                           |
| `dockerfile`       | `string`             | Relatywna sciezka do Dockerfile uzywanego przy budowie obrazu. Plik musi istniec.                                                                                                            |
| `image`            | `string`             | Unikalna nazwa obrazu bez rejestru i taga, np. `projekt-testowy-pipeline/nest-backend-api`.                                                                                                  |
| `package_name`     | `string` albo `null` | Dla `node`: nazwa pakietu z `package.json`, uzywana przez filtry workspace. Dla innych typow: `null`.                                                                                        |
| `Trivy_exceptions` | `array`              | Lista opisanych wyjatkow ze skanowania obrazu. Kazdy wpis ma pola `name` i `cause`. Gdy nie ma wyjatkow, uzyj `[]`.                                                                          |
| `build_output`     | `string` albo `null` | Dla Angulara: sciezka do statycznego wyniku buildu. Dla Spring Boota: wzorzec artefaktu, np. `target/*.jar`. Dla Pythona: `null`.                                                            |
| `server_config`    | `string` albo `null` | Dla Angulara: relatywna sciezka do konfiguracji Nginx. Dla pozostalych frameworkow: `null`.                                                                                                  |
| `start_command`    | `string` albo `null` | Komenda uruchomieniowa w kontenerze dla aplikacji serwerowych. Dla Angulara: `null`, bo obraz startuje przez Nginx.                                                                          |
| `ports`            | `object`             | Porty aplikacji: `host` to port publikowany na hoście, `container` to port wewnatrz kontenera. Oba musza byc unikalnymi liczbami calkowitymi z zakresu `1-65535`; unikalnosc dotyczy `host`. |

Wartosci `name`, `path`, `image`, `ports.host` oraz nazwa zmiennej wyliczana z
`name` po zamianie na wielkie litery i podkreslenia musza byc unikalne.

## Szablony nowych aplikacji

### Node.js backend lub aplikacja serwerowa

```json
{
  "name": "new-node-api",
  "type": "node",
  "framework": "nestjs",
  "version": "24",
  "path": "apps/new_node_api",
  "package_manager": "pnpm",
  "build_tool": null,
  "check_script": "check",
  "dockerfile": ".github/docker/node.Dockerfile",
  "image": "projekt-testowy-pipeline/new-node-api",
  "package_name": "new_node_api",
  "Trivy_exceptions": [],
  "build_output": "dist",
  "server_config": null,
  "start_command": "node dist/main.js",
  "ports": { "host": 10320, "container": 10320 }
}
```

W aplikacji Node skrypt `check_script` musi istniec w `package.json`. Pipeline
nie definiuje samodzielnie lintowania, testow ani typechecku - uruchamia
wskazany skrypt aplikacji.

### Angular frontend

```json
{
  "name": "new-angular-app",
  "type": "node",
  "framework": "angular",
  "version": "24",
  "path": "apps/new_angular_app",
  "package_manager": "pnpm",
  "build_tool": null,
  "check_script": "check",
  "dockerfile": ".github/docker/angular.Dockerfile",
  "image": "projekt-testowy-pipeline/new-angular-app",
  "package_name": "new-angular-app",
  "Trivy_exceptions": [],
  "build_output": "apps/new_angular_app/dist/new_angular_app/browser",
  "server_config": "apps/new_angular_app/nginx.conf",
  "start_command": null,
  "ports": { "host": 10321, "container": 80 }
}
```

Dla `framework: "angular"` wymagane sa `build_output` i `server_config`, a
`start_command` musi byc `null`.

### Python

```json
{
  "name": "new-python-api",
  "type": "python",
  "framework": "stdlib",
  "version": "3.13",
  "path": "apps/new_python_api",
  "package_manager": null,
  "build_tool": "setuptools",
  "check_script": null,
  "dockerfile": ".github/docker/python.Dockerfile",
  "image": "projekt-testowy-pipeline/new-python-api",
  "package_name": null,
  "Trivy_exceptions": [],
  "build_output": null,
  "server_config": null,
  "start_command": "python main.py",
  "ports": { "host": 10322, "container": 10322 }
}
```

Aplikacja Python musi miec `pyproject.toml`. Check uruchamia `uv sync`, `ruff`,
`mypy`, testy `unittest`, `uv build`, Trivy i Semgrep.

### Spring Boot

```json
{
  "name": "new-springboot-app",
  "type": "springboot",
  "framework": "springboot",
  "version": "25",
  "path": "apps/new_springboot_app",
  "package_manager": null,
  "build_tool": "maven",
  "check_script": null,
  "dockerfile": ".github/docker/spring.Dockerfile",
  "image": "projekt-testowy-pipeline/new-springboot-app",
  "package_name": null,
  "Trivy_exceptions": [],
  "build_output": "target/*.jar",
  "server_config": null,
  "start_command": "java -jar /app/app.jar",
  "ports": { "host": 10323, "container": 10323 }
}
```

Dla Maven wymagany jest `pom.xml`. Dla Gradle ustaw `build_tool: "gradle"` i
upewnij sie, ze aplikacja ma wykonywalny `gradlew`.

## Sekcja `deploy`

| Pole           | Typ      | Opis                                                                                                                                                                                               |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment`  | `string` | Nazwa srodowiska GitHub Actions dla deploymentu.                                                                                                                                                   |
| `host`         | `string` | Adres hosta deploymentowego dostepnego przez SSH.                                                                                                                                                  |
| `user`         | `string` | Uzytkownik SSH uzywany przez deployment.                                                                                                                                                           |
| `registry`     | `string` | Lokalny rejestr obrazow Docker, do ktorego trafiaja obrazy tagowane pelnym SHA.                                                                                                                    |
| `compose_file` | `string` | Relatywna sciezka do pliku Compose kopiowanego na host deploymentowy.                                                                                                                              |
| `config_file`  | `string` | Relatywna sciezka do poczatkowego pliku env/config. Jest kopiowany do zdalnego `config.env` tylko wtedy, gdy ten plik jeszcze nie istnieje. (plik docker_deploy/cloudless-print-bridge/config.env) |
| `remote_dir`   | `string` | Katalog docelowy na hoście deploymentowym.                                                                                                                                                         |

## Checklist dodania aplikacji

1. Dodaj katalog aplikacji pod jednym z `pipeline.project_roots`, np. `apps`.
2. Dodaj kompletny wpis w `projects` z unikalnymi `name`, `path`, `image` i
   `ports.host`.
3. Dobierz Dockerfile zgodny z typem aplikacji albo dodaj nowy Dockerfile w
   `.github/docker`.
4. Dla Node dodaj skrypt wskazany przez `check_script` w `package.json`.
5. Dla aplikacji wystawianej w Compose dodaj lub zaktualizuj serwis w
   `deploy/compose.yml` oraz powiazane zmienne w pliku wskazanym przez
   `deploy.config_file`. Po pierwszym wdrożeniu zdalny `config.env` jest
   zarządzany na serwerze produkcyjnym i nie jest nadpisywany przez pipeline.
6. Uruchom walidacje:

```bash
bash .github/steps/validate_projects.sh .github/ci/projects.json
```
