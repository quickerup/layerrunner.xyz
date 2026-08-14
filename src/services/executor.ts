/**
 * Action Executor
 * Executes approved actions against integrated services
 */

import { Env } from '../config';
import { GitHubService, GitHubWorkflowRun } from './github';

export interface ExecutionResult {
  success: boolean;
  output: Record<string, any>;
  error?: string;
  executionTime: number;
}

export class ActionExecutor {
  constructor(private readonly env: Env) {}
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
    const owner = params.owner || this.env.GITHUB_OWNER;
    const repo = params.repo;
    
    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required');
    }

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
    if (!this.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment binding is required');
    }
    return new GitHubService(this.env.GITHUB_TOKEN);
  }
}
