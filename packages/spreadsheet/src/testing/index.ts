// The package's testing entry ("./testing"): fixture builders and the fixture patcher
// for other workspaces' tests. In-package code imports the source files directly.
export * from './build-xlsx';
export { patchFixture, type PatchFixtureOptions } from './patch-fixture';
// Tests that read a cell's raw XML address it by its A1 reference.
export { columnLetters } from '../sheet-meta';
