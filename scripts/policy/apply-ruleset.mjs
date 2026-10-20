// SPDX-License-Identifier: AGPL-3.0-only

// Applies the owner-maintained branch and release policy.
// The owner pushes to develop directly. Every other writer needs a pull request.
// Promotion to main uses an internal PR with CI.
//
// The default is a dry run. Pass --apply to change the repository.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const rulesetName = 'dBrain open source main';
export const tagRulesetName = 'dBrain version tags';
export const developRulesetName = 'dBrain develop';
export const legacyRulesetName = 'dBrain protected branches gate';
export const olderRulesetName = 'dBrain main gate';
export const requiredCheck = 'checks';
// The GitHub Actions application. A required check from another application
// cannot satisfy the rule.
export const actionsAppId = 15368;
// Repository role IDs are fixed by GitHub: 1 read, 2 write, 4 maintain, 5 admin.
// The develop ruleset lets the administrator push directly. Only a collaborator
// with write access can push to any branch, so the rule states the model.
export const adminRoleId = 5;

export const usage = `Usage: node scripts/policy/apply-ruleset.mjs [options]

Print the GitHub repository policy. Pass --apply to write it.

Options:
  --apply              Write the repository settings and the ruleset.
  --repo OWNER/NAME    The repository. The default is the current gh repository.
  --branch NAME        Protect one branch. The default protects main.
  --check NAME         The required status check. The default is ${requiredCheck}.
  --reviewer LOGIN     Release environment reviewer. Defaults to a personal repository owner.
  -h, --help           Print this text.
`;

export function parseArgs(argv) {
  const options = { apply: false, repository: null, branch: null, check: requiredCheck, reviewer: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--repo') options.repository = argv[(index += 1)];
    else if (arg.startsWith('--repo=')) options.repository = arg.slice('--repo='.length);
    else if (arg === '--branch') options.branch = argv[(index += 1)];
    else if (arg.startsWith('--branch=')) options.branch = arg.slice('--branch='.length);
    else if (arg === '--check') options.check = argv[(index += 1)];
    else if (arg.startsWith('--check=')) options.check = arg.slice('--check='.length);
    else if (arg === '--reviewer') options.reviewer = argv[(index += 1)];
    else if (arg.startsWith('--reviewer=')) options.reviewer = arg.slice('--reviewer='.length);
    else if (arg === '-h' || arg === '--help') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

// Merge commits preserve the tagged develop commit in main history.
export function repoSettings() {
  return {
    allow_auto_merge: false,
    allow_merge_commit: true,
    allow_squash_merge: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
    has_issues: true,
    has_discussions: false,
  };
}

export function workflowPermissions() {
  return {
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false,
  };
}

export function releaseEnvironment(reviewerId) {
  return {
    wait_timer: 0,
    prevent_self_review: false,
    reviewers: [{ type: 'User', id: reviewerId }],
    deployment_branch_policy: null,
  };
}

export function rulesetPayload({ branch = null, check = requiredCheck } = {}) {
  return {
    name: rulesetName,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: (branch ? [branch] : ['main']).map(name => `refs/heads/${name}`), exclude: [] } },
    rules: [
      {
        type: 'pull_request',
        parameters: {
          // The ruleset itself must refuse a squash or a rebase. The repository
          // settings below are the second line of defence, not the only one: a
          // squash or rebase would drop the tagged commit from main history.
          allowed_merge_methods: ['merge'],
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: check, integration_id: actionsAppId }],
        },
      },
      // A force push and a branch deletion must not remove a gated commit.
      { type: 'non_fast_forward' },
      { type: 'deletion' },
    ],
  };
}

export function developRulesetPayload() {
  return {
    name: developRulesetName,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/develop'], exclude: [] } },
    rules: [
      // A writer who is not the owner opens a pull request. The owner bypasses
      // the rule, so the direct commit to develop stays available.
      {
        type: 'pull_request',
        parameters: {
          allowed_merge_methods: ['merge'],
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      { type: 'non_fast_forward' },
      { type: 'deletion' },
    ],
    bypass_actors: [{ actor_id: adminRoleId, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
  };
}

export function tagRulesetPayload() {
  return {
    name: tagRulesetName,
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }],
  };
}

export function planRuleset(existing, payload) {
  const found = (existing ?? []).find(entry => entry.name === payload.name) ??
    (payload.target === 'branch' ? (existing ?? []).find(entry => entry.name === legacyRulesetName) : null) ??
    (payload.target === 'branch' ? (existing ?? []).find(entry => entry.name === olderRulesetName) : null);
  return found ? { action: 'update', id: found.id } : { action: 'create', id: null };
}

export function describe(payload, settings, plan) {
  const lines = [];
  lines.push(`Ruleset: ${payload.name}`);
  lines.push(`  Condition: ${payload.conditions.ref_name.include.join(', ')}`);
  lines.push('  Rules:');
  for (const rule of payload.rules) {
    if (rule.type === 'required_status_checks') {
      const contexts = rule.parameters.required_status_checks
        .map(item => `${item.context} (app ${item.integration_id})`)
        .join(', ');
      lines.push(`    - required status checks: ${contexts}`);
      lines.push(
        `    - the branch must be current: ${rule.parameters.strict_required_status_checks_policy}`,
      );
    } else {
      lines.push(`    - ${rule.type}`);
    }
  }
  lines.push('Repository settings:');
  for (const [key, value] of Object.entries(settings)) lines.push(`    - ${key}=${value}`);
  lines.push('Actions permissions:');
  for (const [key, value] of Object.entries(workflowPermissions())) lines.push(`    - ${key}=${value}`);
  lines.push(
    plan.action === 'create'
      ? 'The ruleset does not exist. The script creates it.'
      : `The ruleset exists as ${plan.id}. The script replaces it.`,
  );
  return lines.join('\n');
}

function defaultRun(command, args, options = {}) {
  return spawnSync(command, args, {
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function describeFailure(result) {
  if (result.error) return `Cannot run gh: ${result.error.message}`;
  return (result.stderr || result.stdout || 'the gh command failed').trim();
}

function apiJson(run, args) {
  const result = run('gh', args);
  if (result.status !== 0) {
    throw new Error(describeFailure(result));
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

export async function main(argv, deps = {}) {
  const io = deps.io ?? { log: message => process.stdout.write(`${message}\n`) };
  const run = deps.run ?? defaultRun;
  const options = parseArgs(argv);
  if (options.help) {
    io.log(usage);
    return 0;
  }

  let repository = options.repository;
  if (!repository) {
    const fromGh = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    repository = process.env.GITHUB_REPOSITORY ?? String(fromGh.stdout ?? '').trim();
  }
  if (!repository) {
    io.log('No repository is set. Pass --repo OWNER/NAME.');
    return 1;
  }

  const payload = rulesetPayload({ branch: options.branch, check: options.check });
  const developPayload = developRulesetPayload();
  const tagPayload = tagRulesetPayload();
  const settings = repoSettings();
  let existing = [];
  try {
    existing = apiJson(run, ['api', `repos/${repository}/rulesets`]) ?? [];
  } catch (error) {
    // The plan is still useful without a login. An apply then fails below.
    io.log(`Note: the ruleset list is unavailable (${error.message}). The plan assumes none.`);
  }
  const plan = planRuleset(existing, payload);
  const developPlan = planRuleset(existing, developPayload);
  const tagPlan = planRuleset(existing, tagPayload);
  io.log(describe(payload, settings, plan));
  io.log(`Develop ruleset: ${developPayload.name} (${developPlan.action}) allows a direct owner push, requires a pull request from another writer, and blocks force pushes and deletion.`);
  io.log(`Tag ruleset: ${tagPayload.name} (${tagPlan.action}) protects ${tagPayload.conditions.ref_name.include.join(', ')} from updates and deletion.`);
  io.log(`Release environment: requires review by ${options.reviewer ?? 'the personal repository owner'}.`);
  io.log('Private vulnerability reporting: enabled.');
  io.log('Dependabot vulnerability alerts and security fixes: enabled; version-update PRs are disabled.');

  if (!options.apply) {
    io.log('\nDry run. Pass --apply to write the policy.');
    return 0;
  }

  const reviewerLogin = options.reviewer ?? repository.split('/')[0];
  let reviewer;
  try {
    reviewer = apiJson(run, ['api', `users/${reviewerLogin}`]);
  } catch (error) {
    io.log(`The release reviewer lookup failed: ${error.message}`);
    return 1;
  }
  if (reviewer?.type !== 'User' || !Number.isSafeInteger(reviewer.id)) {
    io.log('The release reviewer must be a GitHub user. Pass --reviewer LOGIN for an organization repository.');
    return 1;
  }

  const patch = Object.entries(settings).flatMap(([key, value]) => ['-F', `${key}=${value}`]);
  const patched = run('gh', ['api', '-X', 'PATCH', `repos/${repository}`, ...patch]);
  if (patched.status !== 0) {
    io.log(`The repository settings failed: ${describeFailure(patched)}`);
    return 1;
  }
  io.log('Repository settings applied.');

  const workflow = run('gh', [
    'api', '-X', 'PUT', `repos/${repository}/actions/permissions/workflow`,
    '--input', '-',
  ], { input: JSON.stringify(workflowPermissions()) });
  if (workflow.status !== 0) {
    io.log(`The Actions permissions failed: ${describeFailure(workflow)}`);
    return 1;
  }
  io.log('Actions permissions applied.');

  for (const [item, itemPlan] of [[payload, plan], [developPayload, developPlan], [tagPayload, tagPlan]]) {
    const ruleset = itemPlan.action === 'create'
      ? run('gh', ['api', '-X', 'POST', `repos/${repository}/rulesets`, '--input', '-'], { input: JSON.stringify(item) })
      : run('gh', ['api', '-X', 'PUT', `repos/${repository}/rulesets/${itemPlan.id}`, '--input', '-'], { input: JSON.stringify(item) });
    if (ruleset.status !== 0) {
      io.log(`The ruleset ${item.name} failed: ${describeFailure(ruleset)}`);
      return 1;
    }
    io.log(`The ruleset ${item.name} is ${itemPlan.action === 'create' ? 'created' : 'updated'}.`);
  }

  const environment = run('gh', [
    'api', '-X', 'PUT', `repos/${repository}/environments/release`, '--input', '-',
  ], { input: JSON.stringify(releaseEnvironment(reviewer.id)) });
  if (environment.status !== 0) {
    io.log(`The release environment failed: ${describeFailure(environment)}`);
    return 1;
  }
  io.log(`Release environment review assigned to ${reviewerLogin}.`);

  const vulnerability = run('gh', ['api', '-X', 'PUT', `repos/${repository}/private-vulnerability-reporting`]);
  if (vulnerability.status !== 0) {
    io.log(`Private vulnerability reporting failed: ${describeFailure(vulnerability)}`);
    return 1;
  }
  io.log('Private vulnerability reporting enabled.');

  for (const [path, name] of [
    ['vulnerability-alerts', 'Dependabot vulnerability alerts'],
    ['automated-security-fixes', 'Dependabot security fixes'],
  ]) {
    const security = run('gh', ['api', '-X', 'PUT', `repos/${repository}/${path}`]);
    if (security.status !== 0) {
      io.log(`${name} failed: ${describeFailure(security)}`);
      return 1;
    }
    io.log(`${name} enabled.`);
  }

  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
