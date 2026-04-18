// Enforces Conventional Commits at commit time via the husky `commit-msg` hook.
// Repo convention from CLAUDE.md: feat / fix / refactor / docs / chore (and
// the standard extensions: style / test / build / ci / perf / revert).
//
// Subject-case rule disabled: lowercase ("add foo") and sentence case
// ("Add foo") both occur in our history and both read fine.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'body-max-line-length': [0], // commit bodies often quote logs / SQL / URLs
    'footer-max-line-length': [0], // Co-Authored-By lines exceed default 100
  },
};
