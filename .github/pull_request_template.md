## Summary

<!-- 1-3 bullet points: what changed and why. Link related issues / docs. -->

## Test plan

<!-- How you verified this works. Mark items as you go. -->

- [ ] Unit tests pass (`pnpm test:unit`)
- [ ] Integration tests pass if any DB / route code touched (`pnpm test:integration`)
- [ ] Manual verification — describe steps if applicable
- [ ] Verified in browser if frontend changes (golden path + at least one edge case)

## Security checklist

<!-- Required for any change touching user data, credentials, auth, RLS, or
     tenant boundaries. State "N/A — pure UI / docs / etc." with one-line
     reason if it doesn't apply. Reference: docs/SECURITY.md -->

- [ ] Every DB query filters by `organizationId` (no bare `where: { storeId }`)
- [ ] Store-scoped operations verify the store belongs to the current org
- [ ] No marketplace credentials logged, returned in API responses, or stored unencrypted
- [ ] Multi-tenancy isolation test added/updated for new or changed org-scoped endpoints
- [ ] Roles enforced server-side via `requireRole(...)`, not just UI hiding
- [ ] No raw `as` casts on parsed JSON / external input — type guards instead

## API contract

<!-- Required if any backend route added or changed. Skip with "N/A" otherwise. -->

- [ ] `pnpm api:sync` ran cleanly and the regenerated `openapi.json` is committed
- [ ] Change logged in `docs/api-changelog.md` under `[Unreleased]`
- [ ] Frontend types regenerated and any breakage fixed in the same PR

## Notes for reviewers

<!-- Anything that doesn't fit above: design tradeoffs, deferred items,
     follow-up PRs, screenshots for visual changes, perf benchmarks, etc. -->
