// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionsAppId,
  adminRoleId,
  describe,
  developRulesetPayload,
  legacyRulesetName,
  main,
  parseArgs,
  planRuleset,
  repoSettings,
  releaseEnvironment,
  requiredCheck,
  rulesetName,
  rulesetPayload,
  tagRulesetPayload,
  workflowPermissions,
} from './apply-ruleset.mjs';

test('main requires CI and an internal PR', () => {
  const payload = rulesetPayload();
  assert.equal(payload.name, rulesetName);
  assert.equal(payload.target, 'branch');
  assert.equal(payload.enforcement, 'active');
  assert.deepEqual(payload.conditions.ref_name.include, ['refs/heads/main']);
  const types = payload.rules.map(rule => rule.type);
  assert.deepEqual(types, ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion']);
  assert.ok(!types.includes('required_linear_history'));
  const status = payload.rules.find(rule => rule.type === 'required_status_checks').parameters;
  assert.equal(status.strict_required_status_checks_policy, true);
  assert.deepEqual(status.required_status_checks, [
    { context: requiredCheck, integration_id: actionsAppId },
  ]);
  const pullRequest = payload.rules.find(rule => rule.type === 'pull_request').parameters;
  assert.deepEqual(pullRequest.allowed_merge_methods, ['merge']);
  assert.equal(pullRequest.required_approving_review_count, 0);
  assert.equal(pullRequest.required_review_thread_resolution, true);
  assert.equal(pullRequest.require_last_push_approval, false);
});

test('the repository settings preserve tagged commits with merge commits', () => {
  assert.deepEqual(repoSettings(), {
    allow_auto_merge: false,
    allow_merge_commit: true,
    allow_squash_merge: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
    has_issues: true,
    has_discussions: false,
  });
});

test('Actions defaults to a read-only token', () => {
  assert.deepEqual(workflowPermissions(), {
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false,
  });
});

test('the release environment requires a reviewer', () => {
  assert.deepEqual(releaseEnvironment(42), {
    wait_timer: 0,
    prevent_self_review: false,
    reviewers: [{ type: 'User', id: 42 }],
    deployment_branch_policy: null,
  });
});

test('version tags cannot be rewritten or deleted', () => {
  const payload = tagRulesetPayload();
  assert.equal(payload.target, 'tag');
  assert.deepEqual(payload.conditions.ref_name.include, ['refs/tags/v*']);
  assert.deepEqual(payload.rules.map(rule => rule.type), ['non_fast_forward', 'deletion']);
  assert.deepEqual(planRuleset([{ id: 8, name: legacyRulesetName }], payload), {
    action: 'create', id: null,
  });
});

test('the plan creates a missing ruleset and replaces a known one', () => {
  const payload = rulesetPayload();
  assert.deepEqual(planRuleset([], payload), { action: 'create', id: null });
  assert.deepEqual(planRuleset([{ id: 7, name: 'another rule' }], payload), {
    action: 'create',
    id: null,
  });
  assert.deepEqual(planRuleset([{ id: 7, name: rulesetName }], payload), {
    action: 'update',
    id: 7,
  });
  assert.deepEqual(planRuleset([{ id: 8, name: legacyRulesetName }], payload), {
    action: 'update', id: 8,
  });
});

test('the description names every rule and the check context', () => {
  const text = describe(rulesetPayload(), repoSettings(), { action: 'create', id: null });
  assert.ok(text.includes('refs/heads/main'));
  assert.ok(text.includes(`${requiredCheck} (app ${actionsAppId})`));
  assert.ok(text.includes('non_fast_forward'));
  assert.ok(text.includes('allow_merge_commit=true'));
  assert.ok(text.includes('creates it'));
});

test('develop requires a pull request from a writer who is not the owner', () => {
  const payload = developRulesetPayload();
  assert.deepEqual(payload.rules.map(rule => rule.type), ['pull_request', 'non_fast_forward', 'deletion']);
  const pullRequest = payload.rules[0].parameters;
  assert.deepEqual(pullRequest.allowed_merge_methods, ['merge']);
  assert.equal(pullRequest.required_approving_review_count, 0);
  assert.deepEqual(payload.bypass_actors, [
    { actor_id: adminRoleId, actor_type: 'RepositoryRole', bypass_mode: 'always' },
  ]);
  assert.equal(adminRoleId, 5);
});

test('the argument parser follows the usage text', () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    repository: null,
    branch: null,
    check: requiredCheck,
    reviewer: null,
    help: false,
  });
  const options = parseArgs(['--apply', '--repo=o/r', '--branch=main', '--check=checks']);
  assert.equal(options.apply, true);
  assert.equal(options.repository, 'o/r');
  assert.equal(options.branch, 'main');
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
});

test('a dry run prints the plan and changes nothing', async () => {
  const output = [];
  const calls = [];
  const code = await main([], {
    io: { log: message => output.push(message) },
    run: (command, args) => {
      calls.push([command, ...args].join(' '));
      if (args.some(arg => arg.includes('rulesets'))) return { status: 0, stdout: '[]' };
      if (args[0] === 'repo') return { status: 0, stdout: 'o/r\n' };
      return { status: 0, stdout: '' };
    },
  });
  assert.equal(code, 0);
  assert.ok(output.join('\n').includes('Dry run'));
  assert.ok(!calls.some(call => call.includes('PATCH')), 'a dry run writes nothing');
  assert.ok(!calls.some(call => call.includes('POST')));
});

test('an apply writes the settings and creates the ruleset', async () => {
  const output = [];
  const calls = [];
  const code = await main(['--apply', '--repo=o/r'], {
    io: { log: message => output.push(message) },
    run: (command, args) => {
      calls.push([command, ...args].join(' '));
      if (args.some(arg => arg.includes('rulesets'))) return { status: 0, stdout: '[]' };
      if (args.some(arg => arg.includes('users/o'))) return { status: 0, stdout: '{"id":42,"type":"User"}' };
      return { status: 0, stdout: '' };
    },
  });
  assert.equal(code, 0);
  assert.ok(calls.some(call => call.includes('PATCH repos/o/r')));
  assert.ok(calls.some(call => call.includes('POST repos/o/r/rulesets')));
  assert.equal(calls.filter(call => call.includes('POST repos/o/r/rulesets')).length, 3);
  assert.ok(calls.some(call => call.includes('PUT repos/o/r/actions/permissions/workflow')));
  assert.ok(calls.some(call => call.includes('PUT repos/o/r/environments/release')));
  assert.ok(calls.some(call => call.includes('PUT repos/o/r/private-vulnerability-reporting')));
  assert.ok(calls.some(call => call.includes('PUT repos/o/r/vulnerability-alerts')));
  assert.ok(calls.some(call => call.includes('PUT repos/o/r/automated-security-fixes')));
  assert.ok(output.join('\n').includes('created'));
});

test('the plan prints without a GitHub login', async () => {
  const output = [];
  const code = await main(['--repo=o/r'], {
    io: { log: message => output.push(message) },
    run: () => ({ status: null, stdout: null, stderr: null, error: new Error('spawnSync gh ENOENT') }),
  });
  assert.equal(code, 0);
  const text = output.join('\n');
  assert.ok(text.includes('unavailable'));
  assert.ok(text.includes('refs/heads/main'));
  assert.ok(text.includes('Dry run'));
});

test('a failed GitHub call reports and stops', async () => {
  const output = [];
  const code = await main(['--apply', '--repo=o/r'], {
    io: { log: message => output.push(message) },
    run: (command, args) => {
      if (args.some(arg => arg.includes('rulesets'))) return { status: 0, stdout: '[]' };
      return { status: 1, stdout: '', stderr: 'Resource not accessible by integration' };
    },
  });
  assert.equal(code, 1);
  assert.ok(output.join('\n').includes('Resource not accessible'));
});
