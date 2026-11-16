import { readFileSync } from 'node:fs';
const yml = readFileSync('.github/workflows/deploy.yml', 'utf8');
const onBlock = yml.split(/^on:\s*$/m)[1]!.split(/^\S/m)[0]!;

test('only a manual trigger', () => {
  expect(onBlock).toMatch(/^\s+workflow_dispatch:/m);
  expect(onBlock).not.toMatch(/push|pull_request|schedule|workflow_run/);
});
test('builds with Node 24, runs the unit tests and deploys dist', () => {
  expect(yml).toMatch(/node-version:\s*['"]?24/);
  expect(yml).toContain('npm ci');
  expect(yml).toContain('npx vitest run');
  expect(yml).toContain('npm run build');
  expect(yml).toMatch(/path:\s*['"]?dist/);
  expect(yml).toMatch(/pages:\s*write/);
  expect(yml).toMatch(/id-token:\s*write/);
});
test('Pages and OIDC permissions sit on the deploy job, not the whole workflow', () => {
  const workflowLevel = yml.split(/^jobs:\s*$/m)[0]!;
  expect(workflowLevel).not.toMatch(/pages:\s*write|id-token:\s*write/);
});
test('checkout keeps no token in the workspace for later steps (npm ci runs third-party scripts)', () => {
  expect(yml).toMatch(/- uses: actions\/checkout@v7\n\s+with:\n(?:\s+#.*\n)*\s+persist-credentials: false\n/);
});
test("the build runs on Singapore time, so __BUILD_DATE__ is the trainee's date", () => {
  expect(yml).toMatch(/- run: npm run build\n\s+env:\n(?:\s+#.*\n)*\s+TZ: Asia\/Singapore\n/);
});
test('the header says what a public repo publishes, and what a private one costs, before the first deploy', () => {
  const header = yml.split(/^name:/m)[0]!;
  expect(header).toMatch(/public/i);
  expect(header).toContain('sources/');
  expect(header).toMatch(/scanned/i);
  expect(header).toMatch(/private/i);
  expect(header).toMatch(/paid/i);
});
test('the header names the public EMTNotes repo, the snapshot page and sources/', () => {
  const header = yml.split(/^name:/m)[0]!;
  expect(header).toContain('EMTNotes');
  expect(header).not.toContain('crew-leader');
  expect(header).toContain('docs/publishing.md');
  expect(header).toContain('tools/publish_history.py');
  expect(header).toContain('sources/');
  expect(header).toMatch(/public/i);
  expect(header).toContain("never this repo's own history");
  expect(header).not.toMatch(/git remote add|git push -u origin main/);
});
test('the workflow names no Pages URL', () => {
  expect(yml).not.toMatch(/https?:\/\/[^\s)'"\]]*github\.io/i);
});
