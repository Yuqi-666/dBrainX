# backend/AGENTS.md

Scope: the `backend/` directory.
Parent map: [../AGENTS.md](../AGENTS.md).

This directory holds the server-side code.
It is the source of truth for business behavior.
`apps/server` hosts it in a Node process.
The desktop app runs the same backend in a local Node process and uses the same PocketBase repositories.

## Layers

| Package | Role | Allowed imports |
| --- | --- | --- |
| `domain` | Entities, repository interfaces, ports, and domain events | `packages/interfaces`, `packages/utils` |
| `application` | Commands and queries that return DTOs | `domain`, `interfaces` |
| `infrastructure` | PocketBase implementations of the ports | `domain`, `interfaces` |
| `adapter-back` | DAOs and a factory over `infrastructure` | `domain`, `infrastructure` |
| `adapter-front` | tRPC router, WebSocket transport, composition root | all of the above |

```text
domain          ->  packages/interfaces, packages/utils
application     ->  domain
infrastructure  ->  domain
adapter-back    ->  infrastructure, domain
adapter-front   ->  application, adapter-back, infrastructure, domain
```

`application` and `infrastructure` are siblings above `domain`.
`infrastructure` does not import `application`.

## Mechanisms

A repository interface lives in `domain/src/repositories/`.
Its implementation lives in `infrastructure/src/repositories/pocketbase-*.repository.ts`.
A mapper in `infrastructure/src/database/mappers/` converts a database record to a model.

A port in `domain/src/ports/` describes an outside effect, for example PDF analysis or video transcoding.
The implementation lives in `infrastructure/src/parsers/` or `infrastructure/src/transcoders/`.

`adapter-front` is the composition root.
`AppContainer` wires the repositories and the services.
It also defines 12 tRPC routers and merges them in `src/trpc/router/index.ts`.
The client imports only the `AppRouter` type.

Identity comes from a verified token, never from a client field.
`infrastructure/src/database/token-verifier.ts` verifies, refreshes, and denies a token.
`infrastructure/src/database/request-scope.ts` carries the token through an async call with `AsyncLocalStorage`.
PocketBase hooks add a second check on file and edge ownership.

Domain events flow through `InMemoryEventBus`.
`adapter-front/src/di/event-bridge.ts` forwards a hardcoded event list to the client.

## Rules

1. Keep every import inside the direction above. No lint rule enforces this direction.
2. The backend never changes the schema. A migration is a hand-written file in `pb/`.
3. Add a repository interface to `domain` before you add an implementation.
4. Add a new module to the matching barrel. The barrels are hand-maintained: `domain/src/index.ts`, `application/src/index.ts`, `infrastructure/src/index.ts`, `adapter-back/src/index.ts`, and `adapter-front/src/index.ts`.
5. Treat the PocketBase client, the repositories, and `AppContainer` as singletons. Call the reset function in a test.
6. Change the node-type union in the domain entity, the infrastructure mappers, `adapter-back/src/dao/node.dao.ts`, and `adapter-front/src/trpc/router/node.ts` together. Web and desktop use the same backend path.
7. Write a test as a co-located `<module>.test.ts` file and run it with `node --test`. Only three backend test files exist today.
8. Remember that no PocketBase transaction exists in this layer. A multi-record write is not atomic. Order the writes and check each result.
