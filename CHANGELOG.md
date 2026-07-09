# Changelog

All notable changes to this project are recorded here.

Format per entry: `<type>: <commit message> (@who) <hash>`
Entries are grouped by version, newest first.

## 0.2.2

- feat(news): auto-push the daily summary to configured groups (@isomoes) 775feab

## 0.2.1

- refactor(config): load .env via explicit dotenv call (@isomoes) c178147
- docs: make README concise with a features list (@isomoes) 3214e6b
- fix(docker): persist news DB on a named volume to avoid SQLITE_CANTOPEN (@isomoes) 5d44626

## 0.2.0

- feat: render news digest as Markdown with clickable per-source links (@isomoes) 968ad2b
- feat: add daily AI news summary command (@isomoes) ac55209
- feat: configurable ad keywords + patterns via a remote rules file (@isomoes) 02e89b5
- chore: move Docker files into docker/ directory (@isomoes) 08de7e8

## 0.1.0

- feat: add Docker packaging and ghcr image + GitHub Release publishing (@isomoes)
- feat: scaffold qq-bot on qq-official-bot SDK (@isomoes) 08a9f8f
- chore: initialize main for rebuild on new tech stack (@isomoes) c3514d6
