declare module "bgg" {
  export type BggClient = (endpoint: string, params?: Record<string, unknown>) => Promise<unknown>;

  export type BggClientOptions = {
    timeout?: number;
    retries?: number;
    [key: string]: unknown;
  };

  export default function createClient(options?: BggClientOptions): BggClient;
}
