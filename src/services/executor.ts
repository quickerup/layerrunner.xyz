/**
 * Action Executor
 * Executes approved actions against integrated services
 */

import { Env } from '../config';
import { ExecutableAction, StepRef } from '../core/planner';
import { GitHubApiError, GitHubService, GitHubWorkflowRun } from './github';

export interface ExecutionResult {
  success: boolean;
  output: Record<string, any>;
  error?: string;
  /** HTTP status of the underlying failure, when it's a classifiable API
   *  error (e.g. GitHubApiError) -- lets callers give actionable guidance
   *  (bad token, no repo access, ...) instead of just the raw message. */
  errorStatus?: number;
  executionTime: number;
}

function isStepRef(value: unknown): value is StepRef {
  return typeof value === 'object' && value !== null && '$stepRef' in value && 'path' in value;
}

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Walks a step's params and swaps any StepRef for the actual value read out
// of the referenced (already-run) step's output -- the resolution half of
// the n8n-style node-linking primitive declared in core/planner.ts.
function resolveStepRefs(value: any, results: Map<string, ExecutionResult>): any {
  if (isStepRef(value)) {
    const source = results.get(value.$stepRef);
    if (!source) throw new Error(`Step "${value.$stepRef}" has not run yet or does not exist.`);
    if (!source.success) throw new Error(`Step "${value.$stepRef}" failed (${source.error}), cannot use its output.`);
    return getPath(source.output, value.path);
  }
  if (Array.isArray(value)) return value.map(item => resolveStepRefs(item, results));
  if (value && typeof value === 'object') {
    const resolved: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) resolved[key] = resolveStepRefs(item, results);
    return resolved;
  }
  return value;
}

export class ActionExecutor {
  constructor(private readonly env: Env, private readonly userGithubToken?: string) {}

  // Runs a plan's steps in order, resolving each step's StepRefs against the
  // outputs of steps that already ran, and keying results by step id so
  // later steps (and callers formatting the final response) can look them up.
  async executePlan(executableSteps: ExecutableAction[]): Promise<Map<string, ExecutionResult>> {
    const results = new Map<string, ExecutionResult>();
    for (const step of executableSteps) {
      const params = resolveStepRefs(step.params, results);
      results.set(step.id, await this.executeAction(step.action, params));
    }
    return results;
  }

  async executeAction(
    action: string,
    params: Record<string, any>
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      let result: any;

      switch (action) {
        case 'github_create_repo':
          result = await this.createGitHubRepo(params);
          break;
        case 'github_list_repos':
          result = await this.listGitHubRepos(params);
          break;
        case 'github_get_repo':
          result = await this.getGitHubRepo(params);
          break;
        case 'github_get_deployments':
          result = await this.getGitHubDeployments(params);
          break;
        case 'github_get_workflow_runs':
          result = await this.getGitHubWorkflowRuns(params);
          break;
        case 'github_deploy':
          result = await this.deployGitHubWorkflow(params);
          break;
        case 'diagnose_deployment':
          result = await this.diagnoseDeployment(params);
          break;
        case 'project_status':
          result = await this.getProjectStatus(params);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return {
        success: true,
        output: result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: {},
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStatus: error instanceof GitHubApiError ? error.status : undefined,
        executionTime: Date.now() - startTime,
      };
    }
  }

  private async createGitHubRepo(params: Record<string, any>) {
    const github = this.initGitHubService();
    const owner = params.owner || this.env.GITHUB_OWNER;
    
    if (!owner) {
      throw new Error('GitHub owner not configured');
    }

    return github.createRepository(owner, {
      name: params.name,
      description: params.description,
      private: params.private,
      auto_init: true,
    });
  }

  private async listGitHubRepos(params: Record<string, any>) {
    const github = this.initGitHubService();
    const owner = params.owner || this.env.GITHUB_OWNER;
    
    if (!owner) {
      throw new Error('GitHub owner not configured');
    }

    return github.listRepositories(owner);
  }

  private async getGitHubRepo(params: Record<string, any>) {
    const github = this.initGitHubService();
    const { owner, repo } = this.resolveRepo(params);
    return github.getRepository(owner, repo);
  }

  private async getGitHubDeployments(params: Record<string, any>) {
    const github = this.initGitHubService();
    const owner = params.owner || this.env.GITHUB_OWNER;
    const repo = params.repo;
    
    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required');
    }

    return github.getDeployments(owner, repo);
  }

  private async getGitHubWorkflowRuns(params: Record<string, any>): Promise<GitHubWorkflowRun[]> {
    const github = this.initGitHubService();
    const { owner, repo } = this.resolveRepo(params);
    return github.getWorkflowRuns(owner, repo);
  }

  private async deployGitHubWorkflow(params: Record<string, any>) {
    const github = this.initGitHubService();
    const { owner, repo } = this.resolveRepo(params);
    const workflowId = params.workflowId || this.env.GITHUB_DEPLOY_WORKFLOW || 'deploy.yml';
    const environment = String(params.environment || this.env.ENVIRONMENT || 'staging');
    const ref = String(params.ref || 'main');

    return github.dispatchWorkflow(owner, repo, workflowId, ref, { environment });
  }

  private async diagnoseDeployment(params: Record<string, any>) {
    const github = this.initGitHubService();
    const { owner, repo } = this.resolveRepo(params);
    const [repository, runs, deployments] = await Promise.all([
      github.getRepository(owner, repo),
      github.getWorkflowRuns(owner, repo),
      github.getDeployments(owner, repo),
    ]);

    return { repository, workflowRuns: runs, deployments };
  }

  private async getProjectStatus(params: Record<string, any>) {
    const github = this.initGitHubService();
    const { owner, repo } = this.resolveRepo(params);
    const [repository, workflowRuns, deployments, health] = await Promise.all([
      github.getRepository(owner, repo),
      github.getWorkflowRuns(owner, repo),
      github.getDeployments(owner, repo),
      this.checkHealth(),
    ]);

    return { repository, workflowRuns, deployments, health };
  }

  private async checkHealth() {
    if (!this.env.APP_HEALTH_URL) {
      return { configured: false };
    }

    const startedAt = Date.now();
    const response = await fetch(this.env.APP_HEALTH_URL, { method: 'GET' });
    return {
      configured: true,
      ok: response.ok,
      status: response.status,
      url: this.env.APP_HEALTH_URL,
      responseTimeMs: Date.now() - startedAt,
    };
  }

  private resolveRepo(params: Record<string, any>): { owner: string; repo: string } {
    const owner = params.owner || this.env.GITHUB_OWNER;
    const repo = params.repo || this.env.GITHUB_REPO;

    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required. Set GITHUB_OWNER and GITHUB_REPO, or include a repo name in your request.');
    }

    return { owner, repo };
  }

  private initGitHubService(): GitHubService {
    const token = this.userGithubToken || this.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('No GitHub token available — connect one with /connect_github, or set GITHUB_TOKEN.');
    }
    return new GitHubService(token);
  }
}
