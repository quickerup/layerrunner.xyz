declare module 'itty-router' {
  type Handler = (request: Request, env: any, context?: any) => Response | Promise<Response>;

  interface RouterInstance {
    get(path: string, handler: Handler): RouterInstance;
    post(path: string, handler: Handler): RouterInstance;
    all(path: string, handler: Handler): RouterInstance;
    handle(request: Request, env: any, context?: any): Response | Promise<Response>;
  }

  export function Router(): RouterInstance;
}
