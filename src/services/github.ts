/**
 * GitHub Integration Service
 * Handles interactions with GitHub API
 */

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url?: string;
  url: string;
  private: boolean;
  default_branch?: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string | null;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubCreateRepoRequest {
  name: string;
  description?: string;
  private?: boolean;
  auto_init?: boolean;
}

export class GitHubApiError extends Error {
  constructor(readonly status: number, readonly path: string, readonly body: string, message: string) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class GitHubService {
  private readonly baseUrl = 'https://api.github.com';

  constructor(private readonly token: string) {
    if (!token) {
      throw new Error('GitHub token is required');
    }
  }

  async listRepositories(owner: string): Promise<GitHubRepository[]> {
    return this.request<GitHubRepository[]>(`/users/${owner}/repos?sort=updated&per_page=20`);
  }

  async createRepository(owner: string, request: GitHubCreateRepoRequest): Promise<GitHubRepository> {
    return this.request<GitHubRepository>('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: request.name,
        description: request.description,
        private: request.private ?? false,
        auto_init: request.auto_init ?? true,
      }),
    });
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    return this.request<GitHubRepository>(`/repos/${owner}/${repo}`);
  }

  async getDeployments(owner: string, repo: string): Promise<Record<string, any>[]> {
    return this.request<Record<string, any>[]>(`/repos/${owner}/${repo}/deployments?per_page=5`);
  }

  async getWorkflowRuns(owner: string, repo: string, perPage = 5): Promise<GitHubWorkflowRun[]> {
    const body = await this.request<{ workflow_runs?: GitHubWorkflowRun[] }>(`/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`);
    return body.workflow_runs ?? [];
  }

  async dispatchWorkflow(owner: string, repo: string, workflowId: string, ref: string, inputs: Record<string, string>): Promise<{ workflowId: string; ref: string; inputs: Record<string, string> }> {
    await this.request<void>(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref, inputs }),
      expectJson: false,
    });

    return { workflowId, ref, inputs };
  }

  private async request<T>(path: string, init: RequestInit & { expectJson?: boolean } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GitHubApiError(
        response.status,
        path,
        text,
        `GitHub API error: ${response.status} ${response.statusText} on ${path}${text ? ` - ${text}` : ''}`
      );
    }

    if (init.expectJson === false || response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Layer-Runners-Telegram-Bot',
    };
  }
}
