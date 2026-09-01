# CapyPos

An AI-assisted point-of-sale till, running today as a real pilot rather than a demo: a small
snack bar in the office, stocked with real goods, sold through Capy-POS. There's no cashier —
each coworker opens the till on their **own phone**, points their phone's camera at the snack
they're taking, and **Capy Clerk** (`/clerk`, camera + voice, `infra/vision-proxy` +
`infra/clerk-agent-relay`) recognizes the item, rings it up, and takes payment right there,
self-checkout, honor-system-adjacent. The pilot's job is surfacing what breaks under real,
concurrent, personal-device use before any of this becomes one of the
[Freshmanna](docs/ECOSYSTEM_PLAN.md) product line's shipped retail offerings.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture (and its own note on
what's real vs. planned), [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) for sprint status,
and [`terraform/README.md`](terraform/README.md) for the live IBM Cloud Code Engine deployment.

---

*Scaffolded with [Angular CLI](https://github.com/angular/angular-cli) version 21.2.12.*

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The
application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default,
the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that
suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the
[Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
