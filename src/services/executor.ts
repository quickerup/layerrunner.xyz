/**
 * Action Executor
 * Executes approved actions against integrated services
 */

import { ExecutionPlan } from '../core/planner';
import { initGitHubService } from './github';

export interface ExecutionResult {
  success: boolean;
  output: Record<string, any>;
  error?: string;
  executionTime: number;
}

export class ActionExecutor {
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
    const github = initGitHubService();
    const owner = params.owner || (globalThis as any).GITHUB_OWNER;
    
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
    const github = initGitHubService();
    const owner = params.owner || (globalThis as any).GITHUB_OWNER;
    
    if (!owner) {
      throw new Error('GitHub owner not configured');
    }

    return github.listRepositories(owner);
  }

  private async getGitHubRepo(params: Record<string, any>) {
    const github = initGitHubService();
    const owner = params.owner || (globalThis as any).GITHUB_OWNER;
    const repo = params.repo;
    
    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required');
    }

    return github.getRepository(owner, repo);
  }

  private async getGitHubDeployments(params: Record<string, any>) {
    const github = initGitHubService();
    const owner = params.owner || (globalThis as any).GITHUB_OWNER;
    const repo = params.repo;
    
    if (!owner || !repo) {
      throw new Error('GitHub owner and repo are required');
    }

    return github.getDeployments(owner, repo);
  }
}
