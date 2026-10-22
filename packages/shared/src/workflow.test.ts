import { expect, it } from 'vitest';
import { isDag, editDependenciesSchema } from './workflow.js';
it('validates DAGs, missing references, self-cycles and transitive cycles without recursion', () => {
  expect(
    isDag(
      ['a', 'b', 'c'],
      [
        { taskId: 'b', dependsOnId: 'a' },
        { taskId: 'c', dependsOnId: 'b' },
      ],
    ),
  ).toBe(true);
  expect(isDag(['a'], [{ taskId: 'a', dependsOnId: 'a' }])).toBe(false);
  expect(isDag(['a'], [{ taskId: 'a', dependsOnId: 'missing' }])).toBe(false);
  expect(
    isDag(
      ['a', 'b'],
      [
        { taskId: 'a', dependsOnId: 'b' },
        { taskId: 'b', dependsOnId: 'a' },
      ],
    ),
  ).toBe(false);
  const ids = Array.from({ length: 10000 }, (_, i) => String(i));
  expect(
    isDag(
      ids,
      ids.slice(1).map((id, i) => ({ taskId: id, dependsOnId: ids[i]! })),
    ),
  ).toBe(true);
});
it('rejects invalid or duplicate dependency identifiers and unknown fields', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  expect(
    editDependenciesSchema.safeParse({ dependencyIds: [id, id] }).success,
  ).toBe(false);
  expect(
    editDependenciesSchema.safeParse({ dependencyIds: ['../escape'] }).success,
  ).toBe(false);
  expect(
    editDependenciesSchema.safeParse({ dependencyIds: [], bypass: true })
      .success,
  ).toBe(false);
});
