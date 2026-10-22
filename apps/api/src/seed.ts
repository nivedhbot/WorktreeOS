import { parseArgs } from 'node:util';
import { loadEnvironment } from './config.js';
import { validateRepositoryPath } from './repositories/validate-path.js';
import { Store } from './storage/store.js';

loadEnvironment();
const { values } = parseArgs({
  options: { repo: { type: 'string' } },
  strict: true,
});
if (!values.repo)
  throw new Error(
    'Usage: npm run seed:dev -- --repo <absolute-local-git-repository-root>',
  );
const path = await validateRepositoryPath(values.repo);
const store = new Store();
try {
  const key = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const repository =
    store.listRepositories().find((item) => key(item.path) === key(path)) ??
    store.createRepository({ name: 'Development sample', path });
  const title = 'Sample: inspect the workspace';
  const existing = store
    .listTasks(repository.id)
    .find((task) => task.title === title);
  const task =
    existing ??
    store.createTask({
      repositoryId: repository.id,
      title,
      objective: 'Development sample only. No agent is started by this task.',
      provider: 'mock',
    });
  console.log(
    `Development sample ready: repository ${repository.id}, task ${task.id}. No runs or events created.`,
  );
} finally {
  store.close();
}
