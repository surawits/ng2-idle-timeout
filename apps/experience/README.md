# Experience (Docs & Playground)

This Angular 18 app ships with the repository to showcase `ng2-idle-timeout`.
It has two routes:

- **/docs** – condensed setup instructions, quick start snippets, and common recipes.
- **/playground** – an interactive surface where you can tune idle/countdown thresholds, emit fake activity, and
  watch the session snapshot update live.

## Commands
- `npm run demo:start` – start the dev server on http://localhost:4200
- `npm run demo:test` – verify the app compiles (development build)
- `npm run demo:build` – create a production build under `apps/experience/dist`

## PrimeNG theme
The app ships with PrimeNG’s Lara Light Teal theme, PrimeIcons, and PrimeFlex utilities. Styles are registered in
`angular.json` so no additional work is required after `npm install`.

## Library link
Imports use a TypeScript path that points directly at `packages/ng2-idle-timeout/src/public-api.ts`, so any local
changes to the library are reflected immediately in the playground. Running `npm run build --workspace=ng2-idle-timeout`
lets you test against the compiled output.
