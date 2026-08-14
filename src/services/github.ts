/**
 * GitHub Integration Service
 * Handles interactions with GitHub API
 */

export interface GitHubConfig {
  token: string;
  owner: string;
  repo?: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  private: boolean;
  created_at: string;
  updated_at: string;
}

export interface GitHubCreateRepoRequest {
  name: string;
  description?: string;
  private?: boolean;
  auto_init?: boolean;
}

export class GitHubService {
  private token: string;
  private baseUrl = 'https://api.github.com';

  constructor(token: string) {
    if (!token) {
      throw new Error('GitHub token is required');
    }
    this.token = token;
  }

  async listRepositories(owner: string): Promise<GitHubRepository[]> {
    const response = await fetch(`${this.baseUrl}/users/${owner}/repos`, {
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    return response.json();
  }

  async createRepository(
    owner: string,
    request: GitHubCreateRepoRequest
  ): Promise<GitHubRepository> {
    const response = await fetch(`${this.baseUrl}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: request.name,
        description: request.description,
        private: request.private || false,
        auto_init: request.auto_init || true,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create repo: ${error.message}`);
    }

    return response.json();
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    return response.json();
  }

  async getDeployments(owner: string, repo: string) {
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/deployments`, {
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    return response.json();
  }
}

/**
 * Initialize GitHub service from environment
 */
export function initGitHubService(): GitHubService {
  const token = (globalThis as any).GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  return new GitHubService(token);
}
