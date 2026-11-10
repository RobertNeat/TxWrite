# `production_deployment`

## Uruchomienie

- automatycznie po `push` do `main` lub `master`;
- ręcznie przez `workflow_dispatch`, opcjonalnie z pełnym `sha`.

## Cel i kroki

Zapewnia, że na produkcji działa obraz TxWrite zbudowany z jednego commita.
Kroki są wykonywane sekwencyjnie:

1. `context` wybiera i normalizuje pełny SHA;
2. `check` sprawdza aplikację (`pnpm run check`, Trivy fs, Semgrep);
3. `build` buduje obraz (`deploy/Dockerfile`), skanuje Trivy i publikuje go
   pod SHA do rejestru lokalnego (ZOT, `192.168.1.162:5000`);
4. `deploy` kopiuje `deploy/compose.prod.yml`/`config.env` przez SSH i
   uruchamia obraz o tym SHA.

## Konfiguracja produkcyjna

Plik `config.env` w katalogu `remote_dir` jest trwałą konfiguracją produkcji.
Przy pierwszym wdrożeniu, jeśli zdalny plik nie istnieje, pipeline kopiuje do
niego `deploy/config.env.example`. Przy kolejnych wdrożeniach istniejący
zdalny `config.env` pozostaje bez zmian i jest używany przez Docker Compose.

**`JWT_SECRET` nie jest ustawiony w `deploy/config.env.example`** (w
przeciwieństwie do placeholdera w repo-root `.env.example`, który jest
poprawną 32+ znakową wartością i mógłby uruchomić produkcję z publicznie
znanym sekretem) — trzeba go ustawić ręcznie na serwerze w zdalnym
`config.env` przed pierwszym użyciem; backend odmawia startu bez niego.

Adres hosta, użytkownik, rejestr, pliki i katalog zdalny są w sekcji `deploy`
pliku [`../ci/projects.json`](../ci/projects.json). Host (`192.168.1.160`) i
użytkownik SSH (`docker_deploy`) są współdzielone z innymi projektami
wdrażanymi na ten serwer (np. hospital-information-system) — `remote_dir`
(`/home/docker_deploy/txwrite`) i port hosta (`10800`, poza zakresem
`10400`-`10443` zajętym przez poprzedni projekt) są unikalne dla TxWrite.

## `projects.env`

`deploy/compose.prod.yml` nie zawiera nazwy obrazu ani portu na stałe —
odwołuje się do zmiennych `TXWRITE_IMAGE`, `TXWRITE_HOST_PORT` i
`TXWRITE_CONTAINER_PORT` (prefiks wyliczony z `name: "txwrite"` w
`projects.json`). Plik `deploy_compose_ssh.sh` generuje je z `projects.json`
do `projects.env` i kopiuje na hosta obok `config.env`; `docker compose` musi
być zawsze wywoływany z obydwoma plikami (`--env-file config.env --env-file
projects.env`), inaczej obraz i port pozostaną nierozwiązane (domyślne
`${VAR:-default}` w `deploy/compose.prod.yml` są zgodne z `projects.json` —
sprawdza to `validate_projects.sh`).

## Układ Compose (produkcja vs lokalnie)

`deploy/compose.prod.yml` jest kanonicznym plikiem deploymentu — bez
`build:`, deploy kopiuje na host tylko ten plik. `deploy/docker-compose.yml`
(w katalogu `deploy/`, bez sufiksu `.prod`) jest odrębnym plikiem do lokalnego
developmentu (`pnpm docker:up`/`docker:down` z katalogu głównego) — buduje
obraz lokalnie i czyta `../.env` (ten sam plik backend czyta też poza
Dockerem). Oba pliki montują wolumeny `data`/`cache` i publikują port
kontenera 10800 (host i kontener używają tego samego numeru portu — backend i
frontend są serwowane z jednego originu, patrz §3 `architecture.md`), ale pod
innymi nazwami projektu Compose (`name:` w każdym pliku), więc wolumeny nie
kolidują.

Zmienne wymagane w zdalnym `config.env` (plik `deploy/config.env.example` jest
wzorem, patrz sekcja wyżej): `JWT_SECRET` (WYMAGANE, min. 32 znaki — backend
bez niego nie wystartuje). Pozostałe zmienne (`COOKIE_SECURE`, SMTP, tunable'y
kompilacji) mają sensowne wartości domyślne w szablonie i nie wymagają zmian
dla wdrożenia LAN po HTTP.

## Healthcheck i toolchain

Obraz deklaruje `HEALTHCHECK` (`GET /api/health` przez `wget`) ze
`start-period` 180s — `deploy/docker/entrypoint.sh` blokuje start na
`luaotfload-tool -u` przy pierwszym uruchomieniu na świeżym wolumenie
`cache`, inaczej zdrowy kontener chwilowo raportowałby `unhealthy`.
`entrypoint.sh` odmawia też startu, jeśli `TEX_REPO_URL` w środowisku
kontenera (ustawiony na stałe w `deploy/compose.prod.yml`) nie zgadza się z
`TL_IMAGE_REPO_URL` zapisanym w obrazie przy buildzie — oba muszą wskazywać
ten sam zamrożony snapshot TeX Live (`docs/project_assumptons/architecture.md`
§6.6).

**Miejsca, w których snapshot jest przypięty (bump wymaga zmiany wszystkich
pięciu, inaczej entrypoint odmówi startu):** `deploy/Dockerfile` ARG
`TEX_REPO_URL`/`TL_SNAPSHOT_KEY` w stage `toolchain` (linia ~43-48) i w stage
`runtime` (linia ~140-141); `deploy/docker-compose.yml` `build.args` i
`environment.TEX_REPO_URL` (lokalny dev); `deploy/compose.prod.yml`
`environment.TEX_REPO_URL` (produkcja — ten plik nie ma `build.args`, bo nie
buduje obrazu, tylko czyta `TL_IMAGE_REPO_URL` zapisany w obrazie już
zbudowanym przez CI z wartości domyślnych Dockerfile'a); `.env.example`
`TEX_REPO_URL` (lokalny dev bez Dockera).
