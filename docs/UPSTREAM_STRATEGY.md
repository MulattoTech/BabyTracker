# Upstream and Compatibility Strategy

## Upstreams

Primary references:

- Baby Buddy — BSD-2-Clause
- Sprout Track — custom attribution/non-commercial/share-alike license

## Important licensing constraint

Sprout Track is not under a conventional permissive OSS license. Before redistributing a derivative or using it commercially, its exact license obligations must be reviewed.

This planning branch does not copy Sprout Track source code.

## Recommended strategy

### Baby Buddy

Treat as:
- compatibility target;
- migration source;
- API/integration reference;
- source of selectively reimplemented concepts.

Prefer:
- Baby Buddy CSV/import compatibility;
- documented endpoint compatibility where valuable;
- Home Assistant/MCP interoperability;
- behavior-driven tests.

### Sprout Track

Treat as:
- feature baseline/reference;
- optional upstream candidate if the eventual implementation is legally and technically based on it.

If the final project forks Sprout Track:
- add its repository as `upstream`;
- isolate custom features into dedicated modules;
- keep upstream edits minimal;
- run automated merge/rebase qualification;
- preserve license notices and required terms.

## Why not dual-merge Git histories?

Baby Buddy and Sprout Track use different stacks, schemas, abstractions, and histories. A repository that directly merges both would be expensive to maintain and would make future upstream syncing fragile.

Use contracts/adapters instead.

## Upstream qualification workflow

For every upstream release:

1. fetch upstream;
2. create temporary integration branch;
3. apply/merge candidate update;
4. run upstream tests;
5. run BabyTracker parity tests;
6. run migration test against representative database;
7. run Docker build on amd64/arm64;
8. run API contract tests;
9. run import compatibility tests;
10. run sleep-prediction regression suite;
11. approve merge only if no blocking regression exists.

## Source-of-truth rule

The custom tracker's canonical schema and acceptance tests become authoritative for its own product.

External upstream behavior is tracked as compatibility/parity requirements, not blindly inherited.
