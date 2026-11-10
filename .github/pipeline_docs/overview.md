# Założenia ogólne

Pipeline GitHub Actions jest niezależną warstwą automatyzacji. Aplikacja
pozostaje właścicielem kodu, zależności, testów i komend jakości; pipeline
wywołuje tylko kontrakt opisany w `projects.json`.

Ten projekt (TxWrite) jest monorepo pnpm (`apps/backend` — NestJS na adapterze
Fastify, `apps/frontend` — Angular) budowanym w jeden obraz Docker
(`deploy/Dockerfile`, wielostopniowy build: frontend + backend + toolchain
TeX Live/pandoc w jednym runtime). `projects.json` opisuje go jako jeden wpis
(`path: "."`), nie jako zestaw niezależnie wdrażanych kontenerów — w
przeciwieństwie do szablonu tego pipeline'u (patrz `pipeline_guidelines.md`),
który zakłada wiele współpracujących kontenerów per aplikacja. Skrypty
`.github/docker/*.Dockerfile` dla Angulara/Pythona/Spring Boota i
`.github/steps/check_python.sh`/`check_spring.sh` pozostają w repo jako
materiał szablonowy pipeline'u, ale nie są używane przez żadny wpis w
`projects.json`.

## Ścieżki

- `check` — walidacja konfiguracji, kontrola jakości, testy, budowanie aplikacji,
  SAST i skanowanie zależności/obrazu;
- `build` — budowa obrazu, skan Trivy i zapis obrazu w lokalnym rejestrze pod
  pełnym SHA;
- `deploy` — uruchomienie dokładnie tego obrazu na produkcji;
- `release` — publikacja obrazu wybranego SHA do GHCR;
- `github_release` — utworzenie wydania o nazwie taga.

Workflowy korzystają z self-hosted runnera. Obrazy są niezmienne, `latest` nie
jest używany, a operacje build/deploy/release są serializowane.

## Lokalne rejestry zależności

Runner i obraz Docker korzystają z lokalnych rejestrów zamiast publicznych,
żeby budowy nie zależały od dostępności/limitów zewnętrznych usług:

- obrazy bazowe (`FROM`) — szablon pipeline'u (`.github/docker/*.Dockerfile`,
  nieużywane w tym repo) zakłada ZOT (`192.168.1.162:5000`) jako źródło obrazów
  bazowych. **`deploy/Dockerfile` (faktycznie używany) pobiera `node:24-bookworm-slim`
  i `debian:bookworm-slim` bezpośrednio z Docker Hub**, nie przez ZOT — to
  odstępstwo od szablonu, nieskorygowane celowo (zmiana `FROM` na ZOT nie była
  proszona przez użytkownika i wpłynęłaby na build off-LAN);
- zależności npm/pnpm — Verdaccio (`192.168.1.163`, przez nginx na porcie 80;
  aplikacja nasłuchuje tylko na `127.0.0.1:4873`), skonfigurowany w `.npmrc`
  w katalogu głównym repozytorium (jeśli nie skonfigurowany, pipeline używa
  rejestru domyślnego); corepack kieruje się tam przez
  `COREPACK_NPM_REGISTRY`.

TeX Live i pandoc są pobierane z zamrożonego snapshotu upstream
(`TEX_REPO_URL`/`TL_SNAPSHOT_KEY`, patrz `docs/project_assumptons/architecture.md`
§6.6), nie z lokalnego rejestru — snapshot jest już zamrożony i wersjonowany,
więc nie wymaga tej samej ochrony co rejestr obrazów/npm.
